const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createLobbyServer } = require('../server');

function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(Error('Timed out: ' + event)); }, 3000);
    function listener(value) {
      if (!predicate(value)) return;
      clearTimeout(timer); socket.off(event, listener); resolve(value);
    }
    socket.on(event, listener);
  });
}
const emit = (socket, name, ...args) => socket.timeout(3000).emitWithAck(name, ...args);
const request = state => ({ gameId: state.id, turnNumber: state.turnNumber });
function horseState(socket, predicate) {
  return predicate(socket.horse) ? Promise.resolve(socket.horse) : waitFor(socket, 'horse:state', predicate);
}
async function fixture(t, horseOptions) {
  const { httpServer, io } = createLobbyServer({ horseOptions });
  const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(r => io.close(r)); });
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + httpServer.address().port;
  async function client(token) {
    const s = connect(base, { autoConnect: false, reconnection: false, forceNew: true, auth: { sessionToken: token } });
    clients.push(s);
    s.on('session', session => { s.session = session; });
    s.on('horse:state', state => { s.horse = state; });
    const ready = waitFor(s, 'lobby:state'); s.connect(); await ready; return s;
  }
  const host = await client(), guest = await client(), spectator = await client();
  await emit(host, 'lobby:join', { name: 'Azaa' });
  await emit(guest, 'lobby:join', { name: 'Bat' });
  return { host, guest, spectator, client, base, clients };
}
async function startHorse(host, length = 12) {
  assert.equal((await emit(host, 'lobby:select', { game: 'horse', trackLength: length })).ok, true);
  assert.equal((await emit(host, 'lobby:start')).ok, true);
  return horseState(host, s => Boolean(s));
}

test('Horse Racing lobby, authoritative throws, movement, turns and full ranking', async t => {
  const throws = [
    [0, 0, 0, 0], [0, 1, 2, 3], [0, 0, 0, 1], [1, 1, 2, 3],
    [0, 0, 0, 0], [1, 1, 2, 3], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]
  ];
  const randomFaces = throws.flat(); let randomCalls = 0;
  const { host, guest, spectator, client } = await fixture(t, {
    randomFace: () => randomFaces[randomCalls++], animationMs: 100, disconnectGraceMs: 100
  });
  await t.test('only host selects game/track; settings synchronize and reject invalid values', async () => {
    assert.equal((await emit(guest, 'lobby:select', { game: 'horse', trackLength: 12 })).ok, false);
    assert.equal((await emit(spectator, 'lobby:select', { game: 'horse', trackLength: 12 })).ok, false);
    assert.equal((await emit(host, 'lobby:select', { game: 'https://evil.test', trackLength: 12 })).ok, false);
    assert.equal((await emit(host, 'lobby:select', { game: 'horse', trackLength: 13 })).ok, false);
    for (const length of [24, 18, 12]) {
      const state = waitFor(guest, 'lobby:state', s => s.selectedGame === 'horse' && s.trackLength === length);
      assert.equal((await emit(host, 'lobby:select', { game: 'horse', trackLength: length })).ok, true);
      assert.equal((await state).trackLength, length);
    }
    assert.equal((await emit(host, 'horse:throw', {})).ok, false);
  });
  await t.test('host start broadcasts selected game and the same initial race; Seat 1 starts', async () => {
    const started = waitFor(guest, 'lobby:started');
    assert.equal((await emit(guest, 'lobby:start')).ok, false);
    assert.equal((await emit(host, 'lobby:start')).ok, true);
    const start = await started;
    const a = await horseState(host, s => Boolean(s)), b = await horseState(guest, s => Boolean(s));
    assert.deepEqual(a, b); assert.equal(start.selectedGame, 'horse'); assert.equal(start.gameId, a.id);
    assert.equal(a.trackLength, 12); assert.equal(a.currentSeat, 0); assert.equal(a.currentPlayerId, host.session.playerId);
    assert.deepEqual(a.players.map(p => [p.name, p.seat, p.position]), [['Azaa', 0, 0], ['Bat', 1, 0]]);
    assert.equal((await emit(host, 'lobby:select', { game: 'alag', trackLength: 24 })).ok, false);
    assert.equal((await emit(host, 'game:roll', {})).ok, false);
  });
  let racer = host;
  await t.test('navigation restores names, IDs, seats, game and current turn without joining', async () => {
    const token = host.session.token, id = host.session.playerId, gameId = host.horse.id;
    host.disconnect(); racer = await client(token);
    const state = await horseState(racer, s => Boolean(s));
    assert.equal(racer.session.playerId, id); assert.equal(state.id, gameId);
    assert.equal(state.currentPlayerId, id); assert.equal(state.players[0].name, 'Azaa'); assert.equal(state.players[0].seat, 0);
  });
  await t.test('rejects non-current, spectator and forged-seat actions without consuming randomness', async () => {
    const payload = { ...request(racer.horse), seat: 0, playerId: racer.session.playerId, faces: [0, 0, 0, 0], steps: 100 };
    assert.equal((await emit(guest, 'horse:throw', payload)).ok, false);
    assert.equal((await emit(spectator, 'horse:throw', payload)).ok, false);
    assert.equal((await emit(racer, 'horse:throw', { gameId: 'forged', turnNumber: 1 })).ok, false);
    assert.equal(randomCalls, 0);
  });
  const { advance } = await import('../race-logic.mjs');
  let oldRequest;
  for (let i = 0; i < throws.length; i++) {
    await t.test('throw ' + (i + 1) + ': shared rules, synchronized position and turn', async () => {
      const before = await horseState(racer, s => s?.phase === 'ready' && (s.lastThrow?.sequence ?? 0) === i);
      const actor = before.currentPlayerId === racer.session.playerId ? racer : guest;
      const previous = before.players.find(p => p.id === before.currentPlayerId);
      const expected = advance(previous, throws[i], before.trackLength);
      const payload = request(before); oldRequest ??= payload;
      const a = waitFor(racer, 'horse:state', s => s.lastThrow?.sequence === i + 1 && s.phase === 'animating');
      const b = waitFor(guest, 'horse:state', s => s.lastThrow?.sequence === i + 1 && s.phase === 'animating');
      assert.equal((await emit(actor, 'horse:throw', { ...payload, faces: [99], position: 99, steps: 99, seat: 99 })).ok, true);
      const state = await a; assert.deepEqual(state, await b);
      assert.deepEqual(state.faces, throws[i]); assert.equal(state.faces.length, 4);
      assert.ok(state.faces.every(f => Number.isInteger(f) && f >= 0 && f <= 3));
      assert.equal(state.lastThrow.steps, expected.steps);
      assert.equal(state.players.find(p => p.id === previous.id).position, expected.position);
      assert.equal(randomCalls, (i + 1) * 4);
      assert.equal((await emit(actor, 'horse:throw', payload)).ok, false);
      assert.equal((await emit(actor, 'horse:throw', oldRequest)).ok, false);
      if (i === 6) {
        assert.equal(expected.position, 12); assert.equal(previous.position, 11);
        assert.deepEqual(state.ranking, [racer.session.playerId]); assert.equal(state.winnerId, racer.session.playerId);
      }
      const after = await horseState(racer, s => s?.lastThrow?.sequence === i + 1 && s.phase !== 'animating');
      const peer = await horseState(guest, s => s?.lastThrow?.sequence === i + 1 && s.phase !== 'animating');
      assert.deepEqual(after, peer);
      if (i < throws.length - 1) {
        const expectedId = i < 6 ? (actor === racer ? guest.session.playerId : racer.session.playerId) : guest.session.playerId;
        assert.equal(after.currentPlayerId, expectedId); assert.equal(after.turnNumber, before.turnNumber + 1);
        assert.equal(after.phase, 'ready');
      } else {
        assert.equal(after.finished, true); assert.equal(after.currentPlayerId, null);
        assert.deepEqual(after.ranking, [racer.session.playerId, guest.session.playerId]);
        assert.ok(after.players.every(p => p.finished && p.position === 12));
        assert.equal((await emit(guest, 'horse:throw', request(after))).ok, false);
      }
    });
  }
  await t.test('a refreshed player receives the exact completed ranking and positions', async () => {
    const refreshed = await client(guest.session.token);
    const state = await horseState(refreshed, s => s?.phase === 'finished');
    assert.deepEqual(state.ranking, racer.horse.ranking); assert.deepEqual(state.players, racer.horse.players);
  });
});

test('Horse Racing uses production random faces and handles offline turns/reconnection', async t => {
  const { host, guest, client } = await fixture(t, { animationMs: 30, disconnectGraceMs: 80 });
  await startHorse(host, 24);
  const hostId = host.session.playerId, token = host.session.token;
  const disconnected = waitFor(guest, 'horse:state', s => !s.players[0].connected);
  host.disconnect(); assert.equal((await disconnected).players[0].connected, false);
  const guestTurn = await horseState(guest, s => s?.phase === 'ready' && s.currentPlayerId === guest.session.playerId);
  const staleTurn = request(guestTurn);
  assert.equal((await emit(guest, 'horse:throw', staleTurn)).ok, true);
  const rolled = await horseState(guest, s => s?.lastThrow?.sequence === 1);
  assert.equal(rolled.faces.length, 4); assert.ok(rolled.faces.every(f => Number.isInteger(f) && f >= 0 && f < 4));
  const again = await horseState(guest, s => s?.turnNumber > guestTurn.turnNumber);
  assert.equal(again.currentPlayerId, guest.session.playerId);
  assert.equal((await emit(guest, 'horse:throw', staleTurn)).ok, false);
  const returned = await client(token);
  const restored = await horseState(returned, s => s?.players[0].connected);
  assert.equal(restored.players[0].id, hostId); assert.equal(restored.trackLength, 24);
  const guestDisconnected = waitFor(returned, 'horse:state', s => !s.players[1].connected);
  guest.disconnect(); await guestDisconnected;
  const hostTurn = await horseState(returned, s => s?.currentPlayerId === hostId && s.phase === 'ready');
  assert.equal((await emit(returned, 'horse:throw', request(hostTurn))).ok, true);
  const waitingForNext = await horseState(returned, s => s?.phase === 'ready' && s.lastThrow?.sequence === 2);
  assert.equal(waitingForNext.currentPlayerId, hostId);
});

test('all offline waits safely and a reconnect resumes an unfinished race', async t => {
  const { host, guest, spectator, client } = await fixture(t, { disconnectGraceMs: 30, animationMs: 20 });
  await startHorse(host);
  const token = host.session.token;
  // An unjoined observer can inspect connection updates, but cannot play.
  const waiting = waitFor(spectator, 'horse:state', s => s.phase === 'waiting');
  host.disconnect(); guest.disconnect();
  await waiting;
  const returned = await client(token);
  const state = await horseState(returned, s => s?.phase === 'ready');
  assert.equal(state.currentPlayerId, returned.session.playerId);
  assert.equal((await emit(returned, 'horse:throw', request(state))).ok, true);
});

test('disconnect during animation keeps the accepted move and advances without waiting for acknowledgements', async t => {
  const { host, guest, client } = await fixture(t, { randomFace: () => 0, animationMs: 80, disconnectGraceMs: 1000 });
  const state = await startHorse(host, 18), token = host.session.token, id = host.session.playerId;
  assert.equal((await emit(host, 'horse:throw', request(state))).ok, true);
  host.disconnect();
  const next = await horseState(guest, s => s?.phase === 'ready' && s.currentPlayerId === guest.session.playerId);
  assert.equal(next.players[0].position, 4); assert.equal(next.players[0].connected, false);
  const resumed = await client(token);
  const restored = await horseState(resumed, s => s?.players[0].connected);
  assert.equal(restored.players[0].position, 4); assert.equal(restored.players[0].id, id);
  assert.equal((await emit(guest, 'horse:throw', request(restored))).ok, true);
  const hostTurn = await horseState(resumed, s => s?.phase === 'ready' && s.currentPlayerId === id);
  assert.equal(hostTurn.players[1].position, 4);
});
