const { test } = require('node:test');
const assert = require('node:assert/strict');
const tick = () => new Promise(r => setImmediate(r));
class Socket {
  connected = true; auth = {}; listeners = new Map(); requests = [];
  on(name, callback) { this.listeners.set(name, callback); }
  receive(name, value) { this.listeners.get(name)?.(value); }
  timeout() { return this; }
  emit(...args) { this.requests.push(args); }
  disconnect() { this.connected = false; this.receive('disconnect'); }
}
const memory = () => { const values = new Map(); return { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };

for (const game of ['alag', 'horse']) test(game + ' restart preempts old animations and ignores old states/acknowledgements', async () => {
  const create = game === 'alag' ? (await import('../alag-multiplayer.mjs')).createAlagMultiplayer : (await import('../race-multiplayer.mjs')).createHorseMultiplayer;
  const socket = new Socket(), writes = [], messages = []; let release;
  const oldAnimation = new Promise(r => { release = r; });
  let controls;
  const client = create({
    async applyState(state, { animate, signal }) { if (animate) await oldAnimation; if (!signal.aborted) writes.push(state.id); },
    renderControls(value) { controls = value; }, onStatus: message => messages.push(message)
  }, { ioFactory: () => socket, storage: memory(), confirmRestart: () => true });
  const event = game === 'alag' ? 'game:state' : 'horse:state';
  const initial = { id: 'old', hostId: 'a', currentPlayerId: 'a', players: [{ id: 'a' }], turnNumber: 1,
    rollSequence: 0, rolled: 0, mode: 'take', eligibleGroupIds: [], phase: 'ready' };
  socket.receive('session', { playerId: 'a', token: 'token' }); socket.receive(event, initial); client.ready(); await tick();
  const rolling = { ...initial, phase: 'animating', rolled: 3, rollSequence: 1, lastThrow: { sequence: 1 } };
  socket.receive(event, rolling); await tick();
  assert.equal(client.canRestart(), true); assert.equal(client.requestRestart(), true);
  const oldRestartAck = socket.requests[0][2];
  socket.receive(event, { ...initial, id: 'new' }); await tick();
  assert.equal(writes.at(-1), 'new'); assert.equal(controls.canRestart, true);
  socket.receive(event, rolling); oldRestartAck(null, { ok: false, error: 'stale restart ack' }); release(); await tick();
  assert.equal(writes.at(-1), 'new'); assert.equal(messages.length, 0);
  assert.equal(game === 'alag' ? client.canRoll() : client.canThrow(), true);
  // A pending old action acknowledgement cannot clear a newer request or display its error.
  if (game === 'alag') client.requestRoll(); else client.requestThrow();
  const oldActionAck = socket.requests.at(-1)[2];
  socket.receive(event, { ...initial, id: 'newer' }); await tick();
  if (game === 'alag') client.requestRoll(); else client.requestThrow();
  oldActionAck(null, { ok: false, error: 'stale action ack' });
  assert.equal(messages.length, 0); assert.equal(game === 'alag' ? client.canRoll() : client.canThrow(), false);
});

test('restart confirmation is required; guests cannot submit restart', async () => {
  const { createAlagMultiplayer } = await import('../alag-multiplayer.mjs');
  for (const [id, confirmed] of [['b', true], ['a', false]]) {
    const socket = new Socket();
    const client = createAlagMultiplayer({ applyState: async () => {}, renderControls() {}, onStatus() {} },
      { ioFactory: () => socket, storage: memory(), confirmRestart: () => confirmed });
    socket.receive('session', { playerId: id, token: 'token' });
    socket.receive('game:state', { id: 'game', hostId: 'a', currentPlayerId: 'a', rollSequence: 0, players: [{ id: 'a' }, { id: 'b' }] });
    client.ready(); await tick(); assert.equal(client.requestRestart(), false); assert.equal(socket.requests.length, 0);
  }
});

test('localStorage restores after tab close; resume entry requires server-confirmed identity', async () => {
  const { createSessionStore } = await import('../session-storage.mjs');
  const { offerResume } = await import('../resume-game.mjs');
  const persistent = memory(), firstTab = memory();
  createSessionStore(persistent, firstTab).setItem('lan-session-token', 'secure-token');
  const restoredStore = createSessionStore(persistent, memory());
  assert.equal(restoredStore.getItem('lan-session-token'), 'secure-token');
  const socket = new Socket(), links = [];
  offerResume({ storage: restoredStore, ioFactory: options => { assert.equal(options.auth.sessionToken, 'secure-token'); return socket; },
    document: { getElementById: () => null, createElement: () => ({}), querySelector: () => ({ append: link => links.push(link) }) } });
  socket.receive('session', { playerId: 'b', token: 'secure-token' });
  socket.receive('lobby:state', { started: true, selectedGame: 'alag', players: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(links.length, 1); assert.equal(links[0].href, 'turtle.html?lan=1'); assert.equal(links[0].textContent, 'Тоглолтдоо буцаж орох');
  assert.equal(socket.connected, false);
  restoredStore.removeItem('lan-session-token'); assert.equal(persistent.getItem('lan-session-token'), undefined);
});

test('reconnect waits for a fresh server snapshot and invalid tokens disable cached controls', async () => {
  const { createAlagMultiplayer } = await import('../alag-multiplayer.mjs');
  const socket = new Socket(), store = memory();
  const client = createAlagMultiplayer({ applyState: async () => {}, renderControls() {}, onStatus() {} }, { ioFactory: () => socket, storage: store });
  const state = { id: 'game', hostId: 'a', currentPlayerId: 'a', players: [{ id: 'a' }], rolled: 0, rollSequence: 0 };
  socket.receive('session', { playerId: 'a', token: 'token' }); socket.receive('game:state', state); client.ready(); await tick();
  assert.equal(client.canRoll(), true); socket.disconnect(); socket.connected = true; socket.receive('connect');
  socket.receive('session', { playerId: 'a', token: 'token' }); assert.equal(client.canRoll(), false);
  socket.receive('game:state', state); await tick(); assert.equal(client.canRoll(), true);
  socket.receive('session:invalid'); assert.equal(client.canRoll(), false); assert.equal(store.getItem('lan-session-token'), undefined);
});
