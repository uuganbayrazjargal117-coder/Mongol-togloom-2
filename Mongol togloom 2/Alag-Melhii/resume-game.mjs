import { createSessionStore } from './session-storage.mjs';

export function offerResume({ ioFactory = globalThis.io, storage = createSessionStore(), document = globalThis.document } = {}) {
  const token = storage.getItem('lan-session-token');
  if (!token || typeof ioFactory !== 'function') return;
  const socket = ioFactory({ auth: { sessionToken: token } });
  let playerId;
  socket.on('session', session => { playerId = session.playerId; storage.setItem('lan-session-token', session.token); });
  socket.on('session:invalid', () => { storage.removeItem('lan-session-token'); socket.disconnect(); });
  socket.on('lobby:state', state => {
    if (state.started && state.players.some(p => p.id === playerId)) {
      const pages = { alag: 'turtle.html?lan=1', horse: 'race.html?lan=1' };
      if (pages[state.selectedGame]) {
        const existing = document.getElementById('resume-game');
        const link = existing || document.createElement('a');
        link.id = 'resume-game'; link.className = 'choice';
        link.textContent = 'Тоглолтдоо буцаж орох'; link.href = pages[state.selectedGame];
        if (!existing) document.querySelector('main').append(link);
        storage.setItem('lan-current-game', JSON.stringify({ gameId: state.currentGameId, gameType: state.selectedGame }));
      }
    }
    // A menu visit must not keep an offline player's turn indefinitely occupied.
    socket.disconnect();
  });
  return socket;
}

if (typeof window !== 'undefined') offerResume();
