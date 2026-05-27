"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRoles,
  createGame,
  addPlayer,
  startGame,
  selectTeam,
  castVote,
  playQuestCard,
  assassinate,
  requiredFailsForQuest,
  visibleState
} = require("../src/rules");

function makeStartedGame(count = 5) {
  const game = createGame("TEST");
  for (let i = 1; i <= count; i += 1) addPlayer(game, `p${i}`, `玩家${i}`);
  startGame(game, "p1");
  return game;
}

function approveCurrentTeam(game) {
  for (const player of game.players) castVote(game, player.id, true);
}

test("role setup respects player-count alignment", () => {
  const roles = buildRoles(7, { percivalMorgana: true, mordred: true, oberon: true });
  const good = roles.filter((role) => ["MERLIN", "PERCIVAL", "LOYAL"].includes(role));
  const evil = roles.filter((role) => !["MERLIN", "PERCIVAL", "LOYAL"].includes(role));
  assert.equal(good.length, 4);
  assert.equal(evil.length, 3);
  assert.equal(roles.includes("MERLIN"), true);
  assert.equal(roles.includes("ASSASSIN"), true);
});

test("five rejected team votes immediately give evil the win", () => {
  const game = makeStartedGame(5);
  for (let round = 0; round < 5; round += 1) {
    const leader = game.players[game.leaderIndex];
    selectTeam(game, leader.id, game.players.slice(0, 2).map((p) => p.id));
    for (const player of game.players) castVote(game, player.id, false);
  }
  assert.equal(game.status, "ended");
  assert.equal(game.winner, "evil");
});

test("quest four needs two fail cards in seven or more player games", () => {
  const game = makeStartedGame(7);
  assert.equal(requiredFailsForQuest(game, 4), 2);
});

test("good players cannot play a fail quest card", () => {
  const game = makeStartedGame(5);
  const good = game.players.find((p) => ["MERLIN", "PERCIVAL", "LOYAL"].includes(p.role));
  const leader = game.players[game.leaderIndex];
  selectTeam(game, leader.id, [good.id, game.players.find((p) => p.id !== good.id).id]);
  approveCurrentTeam(game);
  assert.throws(() => playQuestCard(game, good.id, "fail"), /正义阵营不能/);
});

test("assassin can reverse a three-quest good win by finding Merlin", () => {
  const game = makeStartedGame(5);
  const merlin = game.players.find((p) => p.role === "MERLIN");
  const assassin = game.players.find((p) => p.role === "ASSASSIN");

  while (game.status !== "assassination") {
    const leader = game.players[game.leaderIndex];
    const team = game.players.filter((p) => ["MERLIN", "PERCIVAL", "LOYAL"].includes(p.role)).slice(0, game.questIndex === 1 ? 3 : 2);
    selectTeam(game, leader.id, team.map((p) => p.id));
    approveCurrentTeam(game);
    for (const player of team) playQuestCard(game, player.id, "success");
  }

  assassinate(game, assassin.id, merlin.id);
  assert.equal(game.status, "ended");
  assert.equal(game.winner, "evil");
});

test("private visibility hides Mordred from Merlin and Oberon from evil teammates", () => {
  const game = createGame("SEE");
  for (let i = 1; i <= 7; i += 1) addPlayer(game, `p${i}`, `玩家${i}`);
  game.status = "teamSelection";
  game.players[0].role = "MERLIN";
  game.players[1].role = "PERCIVAL";
  game.players[2].role = "LOYAL";
  game.players[3].role = "LOYAL";
  game.players[4].role = "ASSASSIN";
  game.players[5].role = "MORDRED";
  game.players[6].role = "OBERON";

  const merlinState = visibleState(game, "p1");
  const assassinState = visibleState(game, "p5");
  assert.deepEqual(
    merlinState.me.knowledge.map((k) => k.name),
    ["玩家5", "玩家7"]
  );
  assert.deepEqual(
    assassinState.me.knowledge.map((k) => k.name),
    ["玩家6"]
  );
});
