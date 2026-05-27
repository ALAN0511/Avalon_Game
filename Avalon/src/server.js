"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const {
  createGame,
  addPlayer,
  removePlayer,
  setOptions,
  startGame,
  selectTeam,
  castVote,
  playQuestCard,
  assassinate,
  visibleState,
  uid
} = require("./rules");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const rooms = new Map();
const sockets = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, sockets: sockets.size }));
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found");
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") return socket.destroy();
  const key = req.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.id = uid();
  socket.playerId = null;
  socket.roomCode = null;
  sockets.set(socket.id, socket);

  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let frame;
    while ((frame = readFrame(buffer))) {
      buffer = buffer.slice(frame.bytes);
      if (frame.opcode === 8) return socket.end();
      if (frame.opcode === 1) handleMessage(socket, frame.payload);
    }
  });
  socket.on("close", () => disconnect(socket));
  socket.on("error", () => disconnect(socket));
});

server.listen(PORT, () => {
  console.log(`Avalon Online running at http://localhost:${PORT}`);
});

function handleMessage(socket, raw) {
  try {
    const message = JSON.parse(raw);
    const data = message.data || {};
    if (message.type === "join") {
      const roomCode = normalizeRoom(data.roomCode || createRoomCode());
      const game = rooms.get(roomCode) || createAndStoreRoom(roomCode);
      socket.playerId = data.playerId || uid();
      socket.roomCode = roomCode;
      addPlayer(game, socket.playerId, data.name);
      sendSocket(socket, "joined", { roomCode, playerId: socket.playerId });
      broadcast(roomCode);
      return;
    }

    const game = requireGame(socket);
    const playerId = socket.playerId;
    switch (message.type) {
      case "options":
        setOptions(game, playerId, data);
        break;
      case "start":
        startGame(game, playerId);
        break;
      case "selectTeam":
        selectTeam(game, playerId, data.teamIds || []);
        break;
      case "vote":
        castVote(game, playerId, data.approve);
        break;
      case "questCard":
        playQuestCard(game, playerId, data.card);
        break;
      case "assassinate":
        assassinate(game, playerId, data.targetId);
        break;
      default:
        throw new Error("未知操作。");
    }
    broadcast(socket.roomCode);
  } catch (err) {
    sendSocket(socket, "error", { message: err.message || "操作失败。" });
  }
}

function disconnect(socket) {
  if (!sockets.has(socket.id)) return;
  sockets.delete(socket.id);
  if (!socket.roomCode || !socket.playerId) return;
  const stillConnected = [...sockets.values()].some((s) => s.roomCode === socket.roomCode && s.playerId === socket.playerId);
  if (!stillConnected) {
    const game = rooms.get(socket.roomCode);
    if (game) {
      removePlayer(game, socket.playerId);
      broadcast(socket.roomCode);
      if (game.status === "lobby" && game.players.length === 0) rooms.delete(socket.roomCode);
    }
  }
}

function broadcast(roomCode) {
  const game = rooms.get(roomCode);
  if (!game) return;
  for (const socket of sockets.values()) {
    if (socket.roomCode === roomCode && socket.playerId) {
      sendSocket(socket, "state", visibleState(game, socket.playerId));
    }
  }
}

function sendSocket(socket, type, data) {
  if (socket.destroyed) return;
  socket.write(writeFrame(JSON.stringify({ type, data })));
}

function readFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  const maskOffset = masked ? 4 : 0;
  if (buffer.length < offset + maskOffset + length) return null;
  const mask = masked ? buffer.slice(offset, offset + 4) : null;
  offset += maskOffset;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload: payload.toString("utf8"), bytes: offset + length };
}

function writeFrame(text) {
  const payload = Buffer.from(text);
  const headerLength = payload.length < 126 ? 2 : payload.length < 65536 ? 4 : 10;
  const frame = Buffer.alloc(headerLength + payload.length);
  frame[0] = 0x81;
  if (payload.length < 126) {
    frame[1] = payload.length;
    payload.copy(frame, 2);
  } else if (payload.length < 65536) {
    frame[1] = 126;
    frame.writeUInt16BE(payload.length, 2);
    payload.copy(frame, 4);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(payload.length), 2);
    payload.copy(frame, 10);
  }
  return frame;
}

function createAndStoreRoom(roomCode) {
  const game = createGame(roomCode);
  rooms.set(roomCode, game);
  return game;
}

function createRoomCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function normalizeRoom(value) {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || createRoomCode();
}

function requireGame(socket) {
  if (!socket.roomCode || !rooms.has(socket.roomCode)) throw new Error("请先加入房间。");
  return rooms.get(socket.roomCode);
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
