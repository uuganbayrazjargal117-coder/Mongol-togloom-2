const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { io: connect } = require('socket.io-client');
const { createLobbyServer } = require('../server');
const { createAlagGame, alagRulesReady } = require('../alag-game.cjs');

const emit = (socket, event, ...args) => socket.timeout(3000).emitWithAck(event, ...args);
const action = (state, groupId) => ({ gameId: state.id, turnNumber: state.turnNumber, rollSequence: state.rollSequence, ...(groupId ? { groupId } : {}) });
function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(Error('Timed out: ' + event)); }, 3000);
    function listener(state) { if (!predicate(state)) return; clearTimeout(timer); socket.off(event, listener); resolve(state); }
    socket.on(event, listener);
  });
}
async function fixture(t, dice) {
  let calls = 0;
  const { httpServer, io } = createLobbyServer({ alagOptions: { randomDie: () => {
    const result = dice[calls++]; assert.ok(result >= 1 && result <= 6, 'test die sequence exhausted'); return result;
  } } });
  const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(r => io.close(r)); });
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + httpServer.address().port;
  async function client(token) {
    const socket = connect(base, { autoConnect: false, reconnection: false, forceNew: true, auth: { sessionToken: token } });
    clients.push(socket);
    socket.on('session', session => { socket.session = session; });
    socket.on('game:state', state => { socket.game = state; });
    const ready = waitFor(socket, 'lobby:state'); socket.connect(); await ready; return socket;
  }
  const host = await client(), guest = await client(), spectator = await client();
  await emit(host, 'lobby:join', { name: 'Azaa' }); await emit(guest, 'lobby:join', { name: 'Bat' });
  assert.equal((await emit(host, 'lobby:start')).ok, true);
  return { host, guest, spectator, client, calls: () => calls };
}
function consistent(state) {
  const total = state.groups.filter(g => g.present).reduce((sum, g) => sum + g.n, 0) + state.players.reduce((sum, p) => sum + p.score, 0);
  assert.equal(total, 108); assert.ok(state.players.every(p => p.score >= 0));
  assert.equal(new Set(state.groups.map(g => g.id)).size, 29);
}

test('Alag selection validates authority, synchronizes board/score and advances turn', async t => {
  const { host, guest, spectator, client, calls } = await fixture(t, [3, 3]);
  await t.test('rejects selection before rolling and untrusted/stale roll identities', async () => {
    assert.equal((await emit(host, 'game:select', action(host.game, 'head'))).ok, false);
    assert.equal((await emit(guest, 'game:roll', { ...action(host.game), playerId: host.session.playerId, seat: 0 })).ok, false);
    assert.equal((await emit(host, 'game:roll', { ...action(host.game), gameId: 'forged' })).ok, false);
    assert.equal((await emit(host, 'game:roll', { ...action(host.game), turnNumber: 99 })).ok, false);
    assert.equal(calls(), 0);
  });
  await t.test('server roll determines the same eligible IDs on both clients', async () => {
    const peer = waitFor(guest, 'game:state');
    assert.equal((await emit(host, 'game:roll', { ...action(host.game), result: 6 })).ok, true);
    assert.deepEqual(host.game, await peer);
    assert.equal(host.game.rolled, 3); assert.deepEqual(host.game.eligibleGroupIds, ['head', 'tail', 'metal']);
  });
  await t.test('rejects non-current/spectator, unknown, wrong-value and stale selections without mutation', async () => {
    const before = structuredClone(host.game), request = action(before, 'head');
    for (const [socket, payload] of [
      [guest, { ...request, seat: 0, playerId: host.session.playerId }], [spectator, request],
      [host, { ...request, groupId: 'unknown' }], [host, { ...request, groupId: 'neck' }],
      [host, { ...request, gameId: 'unknown' }], [host, { ...request, turnNumber: 100 }],
      [host, { ...request, rollSequence: 0 }], [host, { ...request, groupId: { id: 'head' } }]
    ]) assert.equal((await emit(socket, 'game:select', payload)).ok, false);
    assert.deepEqual(host.game, before); assert.equal(calls(), 1);
  });
  let oldSelection;
  await t.test('current player takes one group; forged scores/movement are ignored; roll and highlights clear', async () => {
    oldSelection = action(host.game, 'head');
    const peer = waitFor(guest, 'game:state');
    const duplicateClicks = await Promise.all([
      emit(host, 'game:select', { ...oldSelection, score: 999, winner: host.session.playerId, present: true }),
      emit(host, 'game:select', oldSelection)
    ]);
    assert.deepEqual(duplicateClicks.map(response => response.ok), [true, false]);
    assert.deepEqual(host.game, await peer);
    assert.equal(host.game.groups.find(g => g.id === 'head').present, false);
    assert.equal(host.game.players[0].score, 3); assert.equal(host.game.players[1].score, 0);
    assert.equal(host.game.currentPlayerId, guest.session.playerId); assert.equal(host.game.rolled, 0);
    assert.deepEqual(host.game.eligibleGroupIds, []); assert.equal(host.game.turnNumber, 2); consistent(host.game);
  });
  await t.test('duplicate requests and removed groups cannot be taken again', async () => {
    const before = structuredClone(guest.game);
    assert.equal((await emit(host, 'game:select', oldSelection)).ok, false); assert.deepEqual(guest.game, before);
    assert.equal((await emit(guest, 'game:roll', action(guest.game))).ok, true);
    const rolled = structuredClone(guest.game);
    assert.equal((await emit(guest, 'game:select', action(guest.game, 'head'))).ok, false);
    assert.deepEqual(guest.game, rolled); assert.deepEqual(guest.game.eligibleGroupIds, ['tail', 'metal']);
  });
  await t.test('refresh restores exact board, scores, turn, pending die and eligibility without duplicate players', async () => {
    const before = structuredClone(guest.game), id = guest.session.playerId, token = guest.session.token;
    guest.disconnect(); const restored = await client(token);
    assert.equal(restored.session.playerId, id); assert.deepEqual(restored.game, before); assert.equal(restored.game.players.length, 2);
    assert.equal((await emit(restored, 'game:select', action(restored.game, 'tail'))).ok, true);
    const peer = await new Promise(resolve => {
      if (host.game.turnNumber === 3) resolve(host.game);
      else waitFor(host, 'game:state', s => s.turnNumber === 3).then(resolve);
    });
    assert.equal(peer.players[1].score, 3); assert.equal(peer.groups.find(g => g.id === 'tail').present, false);
  });
});

test('no-match automatically restores the first absent group, deducts score, then eliminates an unaffordable return', async t => {
  const { host, guest, client } = await fixture(t, [2, 2, 2, 2, 2, 2]);
  for (const [actor, id] of [[host, 'eyes'], [guest, 'ears'], [host, 'kidneys']]) {
    assert.equal((await emit(actor, 'game:roll', action(actor.game))).ok, true);
    const peer = waitFor(actor === host ? guest : host, 'game:state', s => s.lastAction?.groupId === id);
    assert.equal((await emit(actor, 'game:select', action(actor.game, id))).ok, true);
    await peer;
  }
  const restoredBoard = waitFor(host, 'game:state', s => s.lastAction?.kind === 'return');
  assert.equal((await emit(guest, 'game:roll', action(guest.game))).ok, true);
  const returned = await restoredBoard; assert.deepEqual(returned, guest.game);
  assert.equal(returned.mode, 'return'); assert.equal(returned.rolled, 0);
  assert.equal(returned.groups.find(g => g.id === 'eyes').present, true);
  assert.equal(returned.groups.find(g => g.id === 'ears').present, false);
  assert.equal(returned.lastAction.groupId, 'eyes'); assert.equal(returned.players[1].score, 0);
  assert.equal(returned.currentPlayerId, host.session.playerId); consistent(returned);
  assert.equal((await emit(host, 'game:roll', action(host.game))).ok, true);
  const nextTurn = host.game.turnNumber + 1;
  const guestTurn = waitFor(guest, 'game:state', s => s.turnNumber === nextTurn);
  assert.equal((await emit(host, 'game:select', action(host.game, 'eyes'))).ok, true);
  await guestTurn;
  const finished = waitFor(host, 'game:state', s => s.finished);
  assert.equal((await emit(guest, 'game:roll', action(guest.game))).ok, true);
  const end = await finished; assert.deepEqual(end, guest.game);
  assert.equal(end.lastRoll.value, 2); assert.equal(end.lastAction.kind, 'eliminate');
  assert.equal(end.players[1].eliminated, true); assert.equal(end.players[0].score, 6);
  assert.deepEqual(end.winners, [host.session.playerId]); assert.equal(end.finishReason, 'last-player'); consistent(end);
  assert.equal((await emit(host, 'game:roll', action(end))).ok, false);
  assert.equal((await emit(host, 'game:select', action(end, 'head'))).ok, false);
  const refresh = await client(guest.session.token); assert.deepEqual(refresh.game, end);
});

// Run the actual local game handlers as an independent rule oracle, without WebGL.
async function localGame(count) {
  const { ALAG_GROUPS, eligibleGroups } = await alagRulesReady;
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { value: count, disabled: false, style: {} });
    return elements.get(id);
  } };
  let value;
  const context = { document, URLSearchParams, location: { search: '' }, ALAG_GROUPS, eligibleGroups, Math: Object.assign(Object.create(Math), { random: () => (value - 0.5) / 6 }), structuredClone };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
  const code = source.slice(0, source.indexOf("document.querySelectorAll('[data-count]')")).replace(/^import .*$/gm, '');
  vm.runInContext(code + `
    function setDie(){} async function animateDie(){}
    update=()=>{};started=true;reset();
    globalThis.local={
      roll:()=>$('roll').onclick(),take:id=>select(groups.find(g=>g.id===id)),
      snapshot:()=>structuredClone({groups:groups.map(g=>({id:g.id,present:g.present})),scores,eliminated,player,rolled,mode,finished,message:$('message').textContent})
    };
  `, context);
  return { roll: async die => { value = die; await context.local.roll(); }, take: id => context.local.take(id), snapshot: context.local.snapshot };
}
function agreesWithLocal(state, local) {
  assert.deepEqual(state.groups.map(g => ({ id: g.id, present: g.present })), local.groups);
  assert.deepEqual(state.players.map(p => p.score), local.scores);
  assert.deepEqual(state.players.map(p => p.eliminated), local.eliminated);
  assert.equal(state.currentSeat, local.player); assert.equal(state.rolled, local.rolled);
  assert.equal(state.mode, local.mode); assert.equal(state.finished, local.finished); consistent(state);
}
test('shared catalog matches the existing 108-bone rendering groups', async () => {
  const { ALAG_GROUPS } = await alagRulesReady;
  assert.equal(ALAG_GROUPS.length, 29); assert.equal(ALAG_GROUPS.reduce((sum, g) => sum + g.n, 0), 108);
  const local = await localGame(2); assert.deepEqual(local.snapshot().groups.map(g => g.id), ALAG_GROUPS.map(g => g.id));
});
test('automatic returns, elimination and skipping eliminated players match the original local handlers', async () => {
  const rules = await alagRulesReady, local = await localGame(3);
  let die;
  const game = createAlagGame([0, 1, 2].map(seat => ({ id: String(seat), name: 'Player ' + seat, seat })), () => {}, rules, { randomDie: () => die });
  const steps = [[2, 'eyes'], [2, 'ears'], [2, 'kidneys'], [2], [2, 'eyes'], [2], [1, 'earth'], [2, 'eyes'], [2], [1, 'sky'], [1, 'mountain']];
  for (const [value, groupId] of steps) {
    die = value; let state = game.snapshot(); assert.equal(game.roll(state.currentPlayerId, action(state)).ok, true);
    await local.roll(value); agreesWithLocal(game.snapshot(), local.snapshot());
    if (groupId) {
      state = game.snapshot(); assert.equal(game.select(state.currentPlayerId, action(state, groupId)).ok, true);
      local.take(groupId); agreesWithLocal(game.snapshot(), local.snapshot());
    }
  }
  const state = game.snapshot(); assert.equal(state.players[2].eliminated, true);
  assert.equal(state.finished, false); assert.equal(state.currentSeat, 0);
  const disconnected = structuredClone(state); game.setConnected('0', false);
  assert.equal(game.roll('0', action(state)).ok, false); assert.deepEqual(game.snapshot(), disconnected);
});

function tiedOrder(groups) {
  // Choose 15 of the 29 groups totaling 54; the other 14 also total 54.
  const choices = new Map([['0,0', []]]);
  for (const group of groups) for (const [key, selected] of [...choices]) {
    const [count, sum] = key.split(',').map(Number);
    if (count < 15 && sum + group.n <= 54 && !choices.has((count + 1) + ',' + (sum + group.n))) choices.set((count + 1) + ',' + (sum + group.n), [...selected, group.id]);
  }
  const selected = new Set(choices.get('15,54')); assert.equal(selected.size, 15);
  const a = groups.filter(g => selected.has(g.id)), b = groups.filter(g => !selected.has(g.id));
  return a.flatMap((g, i) => b[i] ? [g, b[i]] : [g]);
}
for (const tied of [false, true]) test('board clearing preserves local ' + (tied ? 'tied highest-score winners' : 'highest-score winner'), async t => {
  const { ALAG_GROUPS } = await alagRulesReady;
  const order = tied ? tiedOrder(ALAG_GROUPS) : ALAG_GROUPS;
  const { host, guest, client } = await fixture(t, order.map(g => g.n));
  const local = await localGame(2);
  for (const [i, group] of order.entries()) {
    const actor = i % 2 ? guest : host;
    assert.equal((await emit(actor, 'game:roll', action(actor.game))).ok, true); await local.roll(group.n);
    const peer = i % 2 ? host : guest, received = waitFor(peer, 'game:state', s => s.lastAction?.groupId === group.id);
    assert.equal((await emit(actor, 'game:select', action(actor.game, group.id))).ok, true);
    local.take(group.id); const state = await received; assert.deepEqual(state, actor.game);
    agreesWithLocal(state, local.snapshot());
  }
  const end = host.game; assert.equal(end.finishReason, 'board-cleared'); assert.equal(end.finished, true);
  const max = Math.max(...end.players.map(p => p.score));
  assert.deepEqual(end.winners, end.players.filter(p => p.score === max).map(p => p.id));
  assert.equal(end.winners.length, tied ? 2 : 1);
  if (tied) assert.deepEqual(end.players.map(p => p.score), [54, 54]);
  const restored = await client(host.session.token); assert.deepEqual(restored.game, end);
});
