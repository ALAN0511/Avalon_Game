"use strict";

const els = {
  joinPanel: document.querySelector("#joinPanel"),
  gamePanel: document.querySelector("#gamePanel"),
  joinBtn: document.querySelector("#joinBtn"),
  nameInput: document.querySelector("#nameInput"),
  roomInput: document.querySelector("#roomInput"),
  connection: document.querySelector("#connection"),
  subtitle: document.querySelector("#subtitle"),
  roomCode: document.querySelector("#roomCode"),
  identity: document.querySelector("#identity"),
  options: document.querySelector("#options"),
  log: document.querySelector("#log"),
  phase: document.querySelector("#phase"),
  quests: document.querySelector("#quests"),
  players: document.querySelector("#players"),
  actions: document.querySelector("#actions"),
  toast: document.querySelector("#toast")
};

let ws = null;
let state = null;
let playerId = localStorage.getItem("avalon.playerId") || crypto.randomUUID();
let selectedTeam = new Set();
localStorage.setItem("avalon.playerId", playerId);
els.nameInput.value = localStorage.getItem("avalon.name") || "";

els.joinBtn.addEventListener("click", join);
els.nameInput.addEventListener("keydown", submitOnEnter);
els.roomInput.addEventListener("keydown", submitOnEnter);

function submitOnEnter(event) {
  if (event.key === "Enter") join();
}

function join() {
  const name = els.nameInput.value.trim() || "玩家";
  localStorage.setItem("avalon.name", name);
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  setConnection("连接中");
  ws.addEventListener("open", () => {
    send("join", { name, roomCode: els.roomInput.value.trim(), playerId });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "joined") {
      playerId = message.data.playerId;
      localStorage.setItem("avalon.playerId", playerId);
      history.replaceState(null, "", `?room=${message.data.roomCode}`);
    }
    if (message.type === "state") {
      state = message.data;
      selectedTeam = new Set(state.selectedTeam || []);
      render();
    }
    if (message.type === "error") showToast(message.data.message);
  });
  ws.addEventListener("close", () => setConnection("已断开"));
}

function send(type, data = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return showToast("连接还没有准备好。");
  ws.send(JSON.stringify({ type, data }));
}

function render() {
  setConnection("已连接");
  els.joinPanel.classList.add("hidden");
  els.gamePanel.classList.remove("hidden");
  els.roomCode.textContent = state.roomCode;
  els.subtitle.textContent = phaseText(state.status);
  renderIdentity();
  renderOptions();
  renderPhase();
  renderQuests();
  renderPlayers();
  renderActions();
  renderLog();
}

function inviteUrl() {
  const url = new URL(location.href);
  url.searchParams.set("room", state.roomCode);
  return url.toString();
}

async function copyInviteLink() {
  const url = inviteUrl();
  try {
    await navigator.clipboard.writeText(url);
    showToast("邀请链接已复制。");
  } catch {
    showToast(url);
  }
}

function renderIdentity() {
  const me = state.me;
  els.identity.className = "identity";
  if (!me) {
    els.identity.innerHTML = `<h2>等待开局</h2><p class="muted">房主开始游戏后会在这里看到你的身份。</p>`;
    return;
  }
  els.identity.classList.add(me.role.side);
  const knowledge = me.knowledge.length
    ? `<div class="knowledge">${me.knowledge.map((k) => `<div>${escapeHtml(k.name)}：${k.hint}</div>`).join("")}</div>`
    : `<p class="muted">没有额外初始信息。</p>`;
  els.identity.innerHTML = `<h2>${me.role.name}</h2><p>${me.role.side === "good" ? "正义阵营" : "邪恶阵营"}</p>${knowledge}`;
}

function renderOptions() {
  if (state.status !== "lobby") {
    els.options.innerHTML = `<strong>规则模块</strong><p class="muted">本局配置已锁定。</p>`;
    return;
  }
  const disabled = state.hostId !== state.viewerId ? "disabled" : "";
  els.options.innerHTML = `
    <strong>身份配置</strong>
    ${optionRow("percivalMorgana", "派西维尔 + 莫甘娜", disabled)}
    ${optionRow("mordred", "莫德雷德", disabled)}
    ${optionRow("oberon", "奥伯伦", disabled)}
  `;
  els.options.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      send("options", {
        percivalMorgana: els.options.querySelector("[data-option='percivalMorgana']").checked,
        mordred: els.options.querySelector("[data-option='mordred']").checked,
        oberon: els.options.querySelector("[data-option='oberon']").checked
      });
    });
  });
}

function optionRow(key, label, disabled) {
  return `
    <label class="option-row">
      <span>${label}</span>
      <input type="checkbox" data-option="${key}" ${state.options[key] ? "checked" : ""} ${disabled} />
    </label>`;
}

function renderPhase() {
  const leader = state.players.find((p) => p.id === state.leaderId);
  const detail = state.rules
    ? `第 ${state.questIndex + 1} 次任务，需要 ${state.rules.currentTeamSize} 人${state.rules.requiredFails === 2 ? "，需 2 张失败牌才失败" : ""}。`
    : `${state.players.length}/10 人，至少 5 人开始。`;
  els.phase.innerHTML = `
    <h2>${phaseText(state.status)}</h2>
    <p class="muted">${detail}</p>
    <p class="muted">当前队长：${leader ? escapeHtml(leader.name) : "-"}</p>
    <p class="muted">连续组队失败：${state.rejectedVotes}/5</p>
  `;
}

function renderQuests() {
  const sizes = state.rules?.teamSizes || [2, 3, 2, 3, 3];
  els.quests.innerHTML = sizes
    .map((size, index) => {
      const result = state.questResults.find((q) => q.quest === index + 1);
      const cls = result ? (result.success ? "success" : "fail") : index === state.questIndex && state.status !== "lobby" ? "current" : "";
      const text = result ? `${result.success ? "成功" : "失败"} · ${result.failCount} 失败牌` : `需要 ${size} 人`;
      return `<div class="quest ${cls}"><strong>任务 ${index + 1}</strong><span class="muted">${text}</span></div>`;
    })
    .join("");
}

function renderPlayers() {
  els.players.innerHTML = state.players
    .map((p) => {
      const badges = [
        p.isHost ? `<span class="badge gold">房主</span>` : "",
        p.isLeader ? `<span class="badge gold">队长</span>` : "",
        state.selectedTeam.includes(p.id) ? `<span class="badge green">任务队员</span>` : "",
        voteBadge(p),
        questBadge(p),
        p.role ? `<span class="badge ${p.role.side === "evil" ? "red" : "green"}">${p.role.name}</span>` : ""
      ].join("");
      return `
        <article class="player ${p.id === state.viewerId ? "me" : ""} ${state.selectedTeam.includes(p.id) ? "selected" : ""} ${
          p.connected ? "" : "disconnected"
        }">
          <div class="player-head"><strong>${escapeHtml(p.name)}</strong><span>${p.connected ? "在线" : "离线"}</span></div>
          <div class="badges">${badges}</div>
        </article>`;
    })
    .join("");
}

function voteBadge(player) {
  if (state.status === "voting") return state.votes[player.id] ? `<span class="badge">已投票</span>` : "";
  if (!state.voteReveal || state.voteReveal[player.id] === undefined) return "";
  return `<span class="badge ${state.voteReveal[player.id] ? "green" : "red"}">${state.voteReveal[player.id] ? "赞成" : "反对"}</span>`;
}

function questBadge(player) {
  if (state.status !== "quest" || !state.selectedTeam.includes(player.id)) return "";
  return state.questCards[player.id] ? `<span class="badge">已出牌</span>` : `<span class="badge">待出牌</span>`;
}

function renderActions() {
  if (state.status === "lobby") return renderLobbyActions();
  if (state.status === "teamSelection") return renderTeamActions();
  if (state.status === "voting") return renderVoteActions();
  if (state.status === "quest") return renderQuestActions();
  if (state.status === "assassination") return renderAssassinationActions();
  if (state.status === "ended") {
    els.actions.innerHTML = `<strong>${state.winner === "good" ? "正义阵营" : "邪恶阵营"}获胜</strong><p>${state.endReason}</p>`;
  }
}

function renderLobbyActions() {
  const canStart = state.hostId === state.viewerId && state.players.length >= 5 && state.players.length <= 10;
  els.actions.innerHTML = `
    <strong>开局</strong>
    <p class="muted">当前 ${state.players.length} 人。房主可在 5-10 人时开始。</p>
    <div class="invite-box">
      <input id="inviteLink" readonly value="${escapeHtml(inviteUrl())}" aria-label="邀请链接" />
      <button class="secondary" id="copyInvite">复制邀请链接</button>
    </div>
    <div class="button-row"><button id="startBtn" ${canStart ? "" : "disabled"}>开始游戏</button></div>
  `;
  els.actions.querySelector("#copyInvite").addEventListener("click", copyInviteLink);
  els.actions.querySelector("#startBtn").addEventListener("click", () => send("start"));
}

function renderTeamActions() {
  const amLeader = state.leaderId === state.viewerId;
  if (!amLeader) {
    els.actions.innerHTML = `<strong>等待队长提名</strong><p class="muted">本轮队长正在选择任务队员。</p>`;
    return;
  }
  els.actions.innerHTML = `
    <strong>选择任务队伍</strong>
    <p class="muted">需要选择 ${state.rules.currentTeamSize} 名玩家。</p>
    <div class="team-grid">${state.players.map((p) => selectablePlayer(p)).join("")}</div>
    <div class="button-row"><button id="submitTeam">提交队伍</button></div>
  `;
  els.actions.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) selectedTeam.add(input.value);
      else selectedTeam.delete(input.value);
      renderTeamActions();
    });
  });
  els.actions.querySelector("#submitTeam").addEventListener("click", () => send("selectTeam", { teamIds: [...selectedTeam] }));
}

function selectablePlayer(player) {
  return `
    <label class="selectable">
      <span>${escapeHtml(player.name)}</span>
      <input type="checkbox" value="${player.id}" ${selectedTeam.has(player.id) ? "checked" : ""} />
    </label>`;
}

function renderVoteActions() {
  if (state.votes[state.viewerId]) {
    els.actions.innerHTML = `<strong>已投票</strong><p class="muted">等待其他玩家完成投票。</p>`;
    return;
  }
  const names = state.selectedTeam.map((id) => state.players.find((p) => p.id === id)?.name).filter(Boolean).join("、");
  els.actions.innerHTML = `
    <strong>组队投票</strong>
    <p class="muted">提名队伍：${escapeHtml(names)}</p>
    <div class="button-row">
      <button id="approve">赞成</button>
      <button class="danger" id="reject">反对</button>
    </div>
  `;
  els.actions.querySelector("#approve").addEventListener("click", () => send("vote", { approve: true }));
  els.actions.querySelector("#reject").addEventListener("click", () => send("vote", { approve: false }));
}

function renderQuestActions() {
  if (!state.selectedTeam.includes(state.viewerId)) {
    els.actions.innerHTML = `<strong>任务执行中</strong><p class="muted">等待任务队员秘密出牌。</p>`;
    return;
  }
  if (state.questCards[state.viewerId]) {
    els.actions.innerHTML = `<strong>已出任务牌</strong><p class="muted">等待其他任务队员。</p>`;
    return;
  }
  const isGood = state.me?.role.side === "good";
  els.actions.innerHTML = `
    <strong>任务出牌</strong>
    <div class="button-row">
      <button id="success">任务成功</button>
      <button class="danger" id="fail" ${isGood ? "disabled" : ""}>任务失败</button>
    </div>
  `;
  els.actions.querySelector("#success").addEventListener("click", () => send("questCard", { card: "success" }));
  els.actions.querySelector("#fail").addEventListener("click", () => send("questCard", { card: "fail" }));
}

function renderAssassinationActions() {
  if (state.me?.role.key !== "ASSASSIN") {
    els.actions.innerHTML = `<strong>刺杀阶段</strong><p class="muted">等待刺客选择梅林。</p>`;
    return;
  }
  els.actions.innerHTML = `
    <strong>刺杀梅林</strong>
    <div class="team-grid">${state.players.map((p) => `<button class="secondary" data-target="${p.id}">${escapeHtml(p.name)}</button>`).join("")}</div>
  `;
  els.actions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => send("assassinate", { targetId: button.dataset.target }));
  });
}

function renderLog() {
  els.log.innerHTML = state.log.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
}

function phaseText(status) {
  return {
    lobby: "等待玩家",
    teamSelection: "队长提名",
    voting: "组队投票",
    quest: "任务出牌",
    assassination: "刺杀梅林",
    ended: "游戏结束"
  }[status];
}

function setConnection(text) {
  els.connection.textContent = text;
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 2800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

const roomFromUrl = new URLSearchParams(location.search).get("room");
if (roomFromUrl) els.roomInput.value = roomFromUrl;
