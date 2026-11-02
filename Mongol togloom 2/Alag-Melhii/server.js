const express = require('express');
const { createServer } = require('node:http');
const { networkInterfaces } = require('node:os');
const path = require('node:path');
const { Server } = require('socket.io');

const { randomUUID, randomInt } = require('node:crypto');
const MAX_PLAYERS = 12;
const PORT = process.env.PORT || 3000;

function createLobbyServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { maxHttpBufferSize: 4096 });
  const players = new Map();
  let hostId = null;
  let started = false;
  let game = null;
  const sessions = new Map();

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
      if (game) socket.emit('game:state', game);
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

    socket.on('lobby:start', acknowledge => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!players.has(socket.data.playerId) || socket.data.playerId !== hostId) {
        return reply({ ok: false, error: 'Only the lobby host can start the game.' });
      }
      if (started) return reply({ ok: false, error: 'The lobby has already started.' });
      started = true;
      const roster = snapshot().players;
      game = { id: randomUUID(), players: roster.map(p => ({ ...p, score: 0, eliminated: false })),
        currentPlayerId: roster[0].id, currentSeat: roster[0].seat,
        rolled: 0, rollSequence: 0, started: true, finished: false };
      io.emit('game:state', game);
      broadcast();
      reply({ ok: true });
    });

    socket.on('game:roll', (payload, acknowledge) => {
      const reply = typeof payload === 'function' ? payload : typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!game || !players.has(socket.data.playerId) || game.finished ||
          socket.data.playerId !== game.currentPlayerId || game.rolled) {
        return reply({ ok: false, error: 'You cannot roll now.' });
      }
      game.rolled = randomInt(1, 7);
      game.rollSequence++;
      io.emit('game:state', game);
      reply({ ok: true });
    });
    socket.on('disconnect', () => {
      const id = socket.data.playerId;
      if (!players.has(id)) return;
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
