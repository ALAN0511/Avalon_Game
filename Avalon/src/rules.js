"use strict";

const crypto = require("crypto");

const QUESTS = {
  5: { good: 3, evil: 2, teams: [2, 3, 2, 3, 3], doubleFailQuest: null },
  6: { good: 4, evil: 2, teams: [2, 3, 4, 3, 4], doubleFailQuest: null },
  7: { good: 4, evil: 3, teams: [2, 3, 3, 4, 4], doubleFailQuest: 4 },
  8: { good: 5, evil: 3, teams: [3, 4, 4, 5, 5], doubleFailQuest: 4 },
  9: { good: 6, evil: 3, teams: [3, 4, 4, 5, 5], doubleFailQuest: 4 },
  10: { good: 6, evil: 4, teams: [3, 4, 4, 5, 5], doubleFailQuest: 4 }
};

const ROLES = {
  MERLIN: { name: "梅林", side: "good" },
  PERCIVAL: { name: "派西维尔", side: "good" },
  LOYAL: { name: "忠臣", side: "good" },
  ASSASSIN: { name: "刺客", side: "evil" },
  MORGANA: { name: "莫甘娜", side: "evil" },
  MORDRED: { name: "莫德雷德", side: "evil" },
  OBERON: { name: "奥伯伦", side: "evil" },
  MINION: { name: "爪牙", side: "evil" }
};

const DEFAULT_OPTIONS = {
  percivalMorgana: true,
  mordred: false,
  oberon: false
};

function uid() {
  return crypto.randomUUID();
}

function createGame(roomCode) {
  return {
    roomCode,
    status: "lobby",
    players: [],
    hostId: null,
    options: { ...DEFAULT_OPTIONS },
    leaderIndex: 0,
    questIndex: 0,
    rejectedVotes: 0,
    selectedTeam: [],
    votes: {},
    questCards: {},
    questResults: [],
    winner: null,
    endReason: "",
    assassinationTarget: null,
    log: []
  };
}

function publicRole(role) {
  return { key: role, ...ROLES[role] };
}

function addPlayer(game, playerId, name) {
  if (game.status !== "lobby") {
    const existing = game.players.find((p) => p.id === playerId);
    if (existing) {
      existing.connected = true;
      return existing;
    }
    throw new Error("游戏已经开始，不能加入新玩家。");
  }

  let player = game.players.find((p) => p.id === playerId);
  if (player) {
    player.name = cleanName(name);
    player.connected = true;
    return player;
  }

  if (game.players.length >= 10) throw new Error("阿瓦隆最多 10 名玩家。");
  player = { id: playerId, name: cleanName(name), connected: true, role: null };
  game.players.push(player);
  if (!game.hostId) game.hostId = player.id;
  game.log.push(`${player.name} 加入了房间。`);
  return player;
}

function removePlayer(game, playerId) {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return;
  player.connected = false;
  if (game.status === "lobby") {
    game.players = game.players.filter((p) => p.id !== playerId);
    if (game.hostId === playerId) game.hostId = game.players[0]?.id ?? null;
  }
}

function cleanName(name) {
  const value = String(name || "").trim().slice(0, 18);
  return value || "玩家";
}

function setOptions(game, playerId, options) {
  assertHost(game, playerId);
  assertStatus(game, "lobby");
  game.options = {
    percivalMorgana: Boolean(options.percivalMorgana),
    mordred: Boolean(options.mordred),
    oberon: Boolean(options.oberon)
  };
}

function startGame(game, playerId) {
  assertHost(game, playerId);
  assertStatus(game, "lobby");
  const count = game.players.length;
  if (!QUESTS[count]) throw new Error("阿瓦隆需要 5 到 10 名玩家。");

  const roles = buildRoles(count, game.options);
  shuffle(roles);
  shuffle(game.players);
  game.players.forEach((player, index) => {
    player.role = roles[index];
  });

  game.status = "teamSelection";
  game.leaderIndex = 0;
  game.questIndex = 0;
  game.rejectedVotes = 0;
  game.selectedTeam = [];
  game.votes = {};
  game.questCards = {};
  game.questResults = [];
  game.winner = null;
  game.endReason = "";
  game.assassinationTarget = null;
  game.log.push("游戏开始，身份已发放。");
}

function buildRoles(count, options) {
  const setup = QUESTS[count];
  const goodRoles = ["MERLIN"];
  const evilRoles = ["ASSASSIN"];

  if (options.percivalMorgana && setup.good >= 2 && setup.evil >= 2) {
    goodRoles.push("PERCIVAL");
    evilRoles.push("MORGANA");
  }
  if (options.mordred && evilRoles.length < setup.evil) evilRoles.push("MORDRED");
  if (options.oberon && evilRoles.length < setup.evil) evilRoles.push("OBERON");

  while (goodRoles.length < setup.good) goodRoles.push("LOYAL");
  while (evilRoles.length < setup.evil) evilRoles.push("MINION");
  return [...goodRoles, ...evilRoles];
}

function selectTeam(game, playerId, teamIds) {
  assertStatus(game, "teamSelection");
  assertLeader(game, playerId);
  const expected = currentTeamSize(game);
  const uniqueTeam = [...new Set(teamIds)];
  if (uniqueTeam.length !== expected) throw new Error(`本轮任务需要 ${expected} 名队员。`);
  uniqueTeam.forEach((id) => assertPlayer(game, id));
  game.selectedTeam = uniqueTeam;
  game.votes = {};
  game.status = "voting";
  game.log.push(`${playerName(game, playerId)} 提名了 ${uniqueTeam.map((id) => playerName(game, id)).join("、")}。`);
}

function castVote(game, playerId, approve) {
  assertStatus(game, "voting");
  assertPlayer(game, playerId);
  game.votes[playerId] = Boolean(approve);
  if (Object.keys(game.votes).length === game.players.length) resolveVote(game);
}

function resolveVote(game) {
  const approvals = Object.values(game.votes).filter(Boolean).length;
  const passed = approvals > game.players.length / 2;
  const summary = `${approvals} 票赞成，${game.players.length - approvals} 票反对`;
  advanceLeader(game);

  if (!passed) {
    game.rejectedVotes += 1;
    game.log.push(`组队投票未通过：${summary}。`);
    game.selectedTeam = [];
    game.votes = {};
    if (game.rejectedVotes >= 5) endGame(game, "evil", "连续 5 次组队失败，邪恶阵营获胜。");
    else game.status = "teamSelection";
    return;
  }

  game.rejectedVotes = 0;
  game.questCards = {};
  game.status = "quest";
  game.log.push(`组队投票通过：${summary}。任务队员开始出牌。`);
}

function playQuestCard(game, playerId, card) {
  assertStatus(game, "quest");
  if (!game.selectedTeam.includes(playerId)) throw new Error("只有任务队员可以出任务牌。");
  const player = assertPlayer(game, playerId);
  const normalized = card === "fail" ? "fail" : "success";
  if (ROLES[player.role].side === "good" && normalized === "fail") {
    throw new Error("正义阵营不能让任务失败。");
  }
  game.questCards[playerId] = normalized;
  if (Object.keys(game.questCards).length === game.selectedTeam.length) resolveQuest(game);
}

function resolveQuest(game) {
  const failCount = Object.values(game.questCards).filter((card) => card === "fail").length;
  const questNumber = game.questIndex + 1;
  const requiredFails = requiredFailsForQuest(game, questNumber);
  const success = failCount < requiredFails;
  game.questResults.push({ quest: questNumber, success, failCount, requiredFails, team: [...game.selectedTeam] });
  game.log.push(`第 ${questNumber} 次任务${success ? "成功" : "失败"}，出现 ${failCount} 张失败牌。`);

  const successes = game.questResults.filter((q) => q.success).length;
  const failures = game.questResults.length - successes;
  game.selectedTeam = [];
  game.questCards = {};

  if (successes >= 3) {
    game.status = "assassination";
    game.log.push("正义阵营完成 3 次任务，刺客获得刺杀梅林的机会。");
    return;
  }
  if (failures >= 3) {
    endGame(game, "evil", "邪恶阵营破坏了 3 次任务。");
    return;
  }

  game.questIndex += 1;
  game.status = "teamSelection";
}

function assassinate(game, playerId, targetId) {
  assertStatus(game, "assassination");
  const assassin = assertPlayer(game, playerId);
  if (assassin.role !== "ASSASSIN") throw new Error("只有刺客可以执行刺杀。");
  const target = assertPlayer(game, targetId);
  game.assassinationTarget = targetId;
  if (target.role === "MERLIN") endGame(game, "evil", "刺客刺中了梅林，邪恶阵营逆转获胜。");
  else endGame(game, "good", "刺客没有刺中梅林，正义阵营获胜。");
}

function endGame(game, winner, reason) {
  game.status = "ended";
  game.winner = winner;
  game.endReason = reason;
  game.log.push(reason);
}

function currentTeamSize(game) {
  return QUESTS[game.players.length].teams[game.questIndex];
}

function requiredFailsForQuest(game, questNumber) {
  return QUESTS[game.players.length].doubleFailQuest === questNumber ? 2 : 1;
}

function visibleState(game, viewerId) {
  const viewer = game.players.find((p) => p.id === viewerId);
  const setup = QUESTS[game.players.length] ?? null;
  return {
    roomCode: game.roomCode,
    status: game.status,
    hostId: game.hostId,
    viewerId,
    players: game.players.map((p, index) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.id === game.hostId,
      isLeader: index === game.leaderIndex,
      role: game.status === "ended" ? publicRole(p.role) : null
    })),
    options: game.options,
    rules: setup
      ? {
          teamSizes: setup.teams,
          currentTeamSize: game.status === "lobby" ? null : currentTeamSize(game),
          requiredFails: game.status === "lobby" ? null : requiredFailsForQuest(game, game.questIndex + 1)
        }
      : null,
    leaderId: game.players[game.leaderIndex]?.id ?? null,
    questIndex: game.questIndex,
    rejectedVotes: game.rejectedVotes,
    selectedTeam: game.selectedTeam,
    votes: Object.fromEntries(game.players.map((p) => [p.id, game.votes[p.id] === undefined ? null : "voted"])),
    voteReveal: game.status === "quest" || game.status === "assassination" || game.status === "ended" ? game.votes : null,
    questCards: Object.fromEntries(game.selectedTeam.map((id) => [id, game.questCards[id] ? "played" : null])),
    questResults: game.questResults,
    winner: game.winner,
    endReason: game.endReason,
    assassinationTarget: game.assassinationTarget,
    log: game.log.slice(-20),
    me: viewer ? privateInfo(game, viewer) : null
  };
}

function privateInfo(game, viewer) {
  if (game.status === "lobby" || !viewer.role) return null;
  const role = publicRole(viewer.role);
  return {
    role,
    knowledge: roleKnowledge(game, viewer)
  };
}

function roleKnowledge(game, viewer) {
  const role = viewer.role;
  if (role === "MERLIN") {
    return game.players
      .filter((p) => ROLES[p.role].side === "evil" && p.role !== "MORDRED")
      .map((p) => ({ id: p.id, name: p.name, hint: "邪恶阵营" }));
  }
  if (role === "PERCIVAL") {
    return game.players
      .filter((p) => p.role === "MERLIN" || p.role === "MORGANA")
      .map((p) => ({ id: p.id, name: p.name, hint: "可能是梅林" }));
  }
  if (ROLES[role].side === "evil" && role !== "OBERON") {
    return game.players
      .filter((p) => p.id !== viewer.id && ROLES[p.role].side === "evil" && p.role !== "OBERON")
      .map((p) => ({ id: p.id, name: p.name, hint: "邪恶同伴" }));
  }
  return [];
}

function advanceLeader(game) {
  game.leaderIndex = (game.leaderIndex + 1) % game.players.length;
}

function assertStatus(game, status) {
  if (game.status !== status) throw new Error(`当前阶段不能执行该操作。`);
}

function assertHost(game, playerId) {
  if (game.hostId !== playerId) throw new Error("只有房主可以执行该操作。");
}

function assertLeader(game, playerId) {
  if (game.players[game.leaderIndex]?.id !== playerId) throw new Error("只有队长可以提名队伍。");
}

function assertPlayer(game, playerId) {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw new Error("找不到该玩家。");
  return player;
}

function playerName(game, playerId) {
  return assertPlayer(game, playerId).name;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

module.exports = {
  QUESTS,
  ROLES,
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
  buildRoles,
  currentTeamSize,
  requiredFailsForQuest,
  uid
};
