const express = require('express');
const { createServer } = require('node:http');
const { networkInterfaces } = require('node:os');
const path = require('node:path');
const { Server } = require('socket.io');
const { createHorseGame } = require('./horse-game.cjs');
const { createAlagGame, alagRulesReady } = require('./alag-game.cjs');

const { randomUUID } = require('node:crypto');
const MAX_PLAYERS = 12;
const PORT = process.env.PORT || 3000;

function createLobbyServer({ horseOptions, alagOptions } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { maxHttpBufferSize: 4096 });
  const players = new Map();
  let hostId = null;
  let started = false;
  let game = null;
  let horseGame = null;
  let selectedGame = 'alag';
  let trackLength = 18;
  const sessions = new Map();
  httpServer.on('close', () => { horseGame?.close(); game?.close(); });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Serve the existing application in place, without exposing Node dependencies or tests.
  app.use((req, res, next) => {
    let pathname;
    try { pathname = decodeURIComponent(req.path).toLowerCase(); }
    catch { return res.sendStatus(400); }
    const parts = pathname.split('/');
    if (parts.some(part => part.startsWith('.') || ['node_modules', 'tests'].includes(part)) ||
        ['server.js', 'package.json', 'package-lock.json'].includes(parts.at(-1)) ||
        /\.(?:md|ya?ml|log|cjs)$/u.test(pathname)) {
      return res.sendStatus(404);
    }
    next();
  });
  app.use(express.static(path.join(__dirname)));
  // Do not return Express error stacks or local filesystem paths to browsers.
  app.use((_error, _req, res, _next) => res.sendStatus(500));

  function snapshot() {
    return {
      players: [...players.values()].sort((a, b) => a.seat - b.seat),
      hostId,
      maxPlayers: MAX_PLAYERS,
      selectedGame,
      trackLength,
      currentGameId: horseGame?.snapshot().id ?? game?.snapshot().id ?? null,
      started
    };
  }
  const broadcast = () => io.emit('lobby:state', snapshot());

  io.on('connection', socket => {
    const token = socket.handshake.auth?.sessionToken;
    const restored = sessions.get(token);
    if (players.has(restored)) {
      socket.data.playerId = restored;
      socket.emit('session', { token, playerId: restored });
      if (horseGame) {
        horseGame.setConnected(restored, true);
        socket.emit('horse:state', horseGame.snapshot());
      }
      if (game) {
        game.setConnected(restored, true);
        socket.emit('game:state', game.snapshot());
      }
    } else if (token) {
      socket.emit('session:invalid');
    }
    // Connections do not occupy a seat until Join Game is accepted.
    socket.emit('lobby:state', snapshot());

    socket.on('lobby:join', (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (players.has(socket.data.playerId)) return reply({ ok: true });
      if (started) return reply({ ok: false, error: 'Game already started.' });
      const name = typeof payload?.name === 'string' ? payload.name.trim().replace(/\s+/gu, ' ') : '';
      if (!name || name.length > 30 || /[\u0000-\u001f\u007f]/u.test(name)) {
        return reply({ ok: false, error: 'Enter a player name of 1–30 characters.' });
      }
      if (players.size >= MAX_PLAYERS) {
        return reply({ ok: false, error: 'The lobby is full (12 players maximum).' });
      }
      const occupied = new Set([...players.values()].map(player => player.seat));
      let seat = 0;
      while (occupied.has(seat)) seat++;
      socket.data.playerId = socket.id;
      const token = randomUUID();
      sessions.set(token, socket.id);
      socket.emit('session', { token, playerId: socket.id });
      players.set(socket.id, { id: socket.id, name, seat });
      if (hostId === null) hostId = socket.id;
      broadcast();
      reply({ ok: true });
    });

    socket.on('lobby:select', (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (socket.data.playerId !== hostId || !players.has(socket.data.playerId) || started) {
        return reply({ ok: false, error: 'Only the host can change settings before starting.' });
      }
      if (!['alag', 'horse'].includes(payload?.game) || ![12, 18, 24].includes(payload?.trackLength)) {
        return reply({ ok: false, error: 'Choose a valid game and track length.' });
      }
      selectedGame = payload.game;
      trackLength = payload.trackLength;
      broadcast();
      reply({ ok: true });
    });

    socket.on('lobby:start', async acknowledge => {
      // Load the shared logical catalog before validating/locking this start request.
      const alagRules = selectedGame === 'alag' ? await alagRulesReady : null;
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!players.has(socket.data.playerId) || socket.data.playerId !== hostId) {
        return reply({ ok: false, error: 'Only the lobby host can start the game.' });
      }
      if (started) return reply({ ok: false, error: 'The lobby has already started.' });
      started = true;
      const roster = snapshot().players;
      if (selectedGame === 'horse') {
        horseGame = createHorseGame(roster, trackLength, state => io.emit('horse:state', state), { ...horseOptions, hostId });
        for (const p of roster) {
          horseGame.setConnected(p.id, [...io.sockets.sockets.values()].some(s => s.data.playerId === p.id));
        }
        io.emit('horse:state', horseGame.snapshot());
      } else {
        game = createAlagGame(roster, state => io.emit('game:state', state), alagRules, { ...alagOptions, hostId });
        for (const p of roster) game.setConnected(p.id, [...io.sockets.sockets.values()].some(s => s.data.playerId === p.id));
        io.emit('game:state', game.snapshot());
      }
      io.emit('lobby:started', { selectedGame, gameId: horseGame?.snapshot().id ?? game.snapshot().id });
      broadcast();
      reply({ ok: true });
    });

    socket.on('game:switch', async (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      const rules = payload?.targetGame === 'alag' ? await alagRulesReady : null;
      if (!socket.connected || !players.has(socket.data.playerId) || socket.data.playerId !== hostId) {
        return reply({ ok: false, error: 'Only the host can switch games.' });
      }
      const active = selectedGame === 'horse' ? horseGame : game;
      if (!started || !active || payload?.gameId !== active.snapshot().id) {
        return reply({ ok: false, error: 'This switch request is stale or there is no active game.' });
      }
      if (!['alag', 'horse'].includes(payload.targetGame) || payload.targetGame === selectedGame ||
          Object.keys(payload).some(key => !['gameId', 'targetGame', 'trackLength'].includes(key)) ||
          (payload.targetGame === 'horse' && ![12, 18, 24].includes(payload.trackLength)) ||
          (payload.trackLength !== undefined && ![12, 18, 24].includes(payload.trackLength)) || players.size < 2) {
        return reply({ ok: false, error: 'Choose another valid game and track length with at least two joined players.' });
      }
      const previousGameId = active.snapshot().id;
      const target = payload.targetGame, length = payload.trackLength ?? trackLength;
      const roster = snapshot().players;
      let replacement;
      const publish = state => {
        if ((target === 'horse' ? horseGame : game) === replacement) io.emit(target === 'horse' ? 'horse:state' : 'game:state', state);
      };
      replacement = target === 'horse'
        ? createHorseGame(roster, length, publish, { ...horseOptions, hostId })
        : createAlagGame(roster, publish, rules, { ...alagOptions, hostId });
      for (const p of roster) replacement.setConnected(p.id, [...io.sockets.sockets.values()].some(s => s.data.playerId === p.id));
      replacement.restart(); // Fresh state, first connected seat; no premature candidate broadcasts.
      active.close(); game = null; horseGame = null;
      selectedGame = target; trackLength = length;
      if (target === 'horse') horseGame = replacement; else game = replacement;
      const state = replacement.snapshot();
      io.emit('game:switched', { previousGameId, gameId: state.id, targetGame: target, trackLength });
      io.emit(target === 'horse' ? 'horse:state' : 'game:state', state);
      broadcast();
      reply({ ok: true, gameId: state.id });
    });

    socket.on('game:restart', (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      const active = selectedGame === 'horse' ? horseGame : game;
      if (!socket.connected || !players.has(socket.data.playerId) || socket.data.playerId !== hostId) {
        return reply({ ok: false, error: 'Only the host can restart the game.' });
      }
      if (!started || !active || payload?.gameId !== active.snapshot().id) {
        return reply({ ok: false, error: 'This restart request is stale or there is no active game.' });
      }
      reply({ ok: true, gameId: active.restart() });
    });

    socket.on('game:roll', (payload, acknowledge) => {
      const reply = typeof payload === 'function' ? payload : typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!socket.connected || !game || !players.has(socket.data.playerId)) {
        return reply({ ok: false, error: 'You cannot roll now.' });
      }
      reply(game.roll(socket.data.playerId, payload));
    });
    socket.on('game:select', (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!socket.connected || !game || !players.has(socket.data.playerId)) {
        return reply({ ok: false, error: 'You cannot select a group now.' });
      }
      reply(game.select(socket.data.playerId, payload));
    });
    socket.on('horse:throw', async (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!socket.connected || !players.has(socket.data.playerId) || !horseGame) {
        return reply({ ok: false, error: 'You are not in an active horse race.' });
      }
      const response = await horseGame.throwFor(socket.data.playerId, payload, () => socket.connected);
      if (socket.connected) reply(response);
    });
    socket.on('disconnect', () => {
      const id = socket.data.playerId;
      if (!players.has(id)) return;
      if (horseGame && ![...io.sockets.sockets.values()].some(s => s.data.playerId === id)) {
        horseGame.setConnected(id, false);
      }
      if (game && ![...io.sockets.sockets.values()].some(s => s.data.playerId === id)) game.setConnected(id, false);
      // Allow navigation/reconnection; keep a started game's roster fixed.
      const timer = setTimeout(() => {
        if (started || [...io.sockets.sockets.values()].some(s => s.data.playerId === id)) return;
        players.delete(id);
        for (const [token, owner] of sessions) if (owner === id) sessions.delete(token);
        if (hostId === id) hostId = players.keys().next().value ?? null;
        broadcast();
      }, 15000);
      timer.unref();
    });
  });

  return { app, httpServer, io };
}

if (require.main === module) {
  const { httpServer } = createLobbyServer();
  httpServer.on('error', error => {
    console.error(`Unable to start multiplayer server: ${error.message}`);
    process.exitCode = 1;
  });
  httpServer.listen(PORT, '0.0.0.0', () => {
    const port = httpServer.address().port;
    console.log(`Multiplayer server listening on 0.0.0.0:${port}`);
    console.log(`Local game menu: http://localhost:${port}`);
    console.log(`Local lobby: http://localhost:${port}/lobby.html`);
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) {
          console.log(`LAN address: http://${address.address}:${port}`);
        }
      }
    }
  });
}

module.exports = { createLobbyServer };
