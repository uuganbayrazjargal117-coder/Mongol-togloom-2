(() => {
  const $ = id => document.getElementById(id);
  if (typeof io !== 'function') {
    $('connection').textContent = 'Server unavailable. Open this lobby through http://HOST_IP:3000 after starting Node.js.';
    return;
  }
  const socket = io({ auth: { sessionToken: sessionStorage.getItem('lan-session-token') } });
  let playerId = null;
  socket.on('session', session => {
    playerId = session.playerId;
    sessionStorage.setItem('lan-session-token', session.token);
    socket.auth.sessionToken = session.token;
  });
  let state = { players: [], maxPlayers: 12, hostId: null, started: false };
  let pending = false;
  // A name is remembered per tab; the server assigns a fresh socket identity on reconnect.
  let rememberedName = '';
  try { rememberedName = sessionStorage.getItem('lan-player-name') || ''; } catch {}
  $('player-name').value = rememberedName;

  function render() {
    const me = state.players.find(player => player.id === playerId);
    const host = state.players.find(player => player.id === state.hostId);
    const isHost = Boolean(me && me.id === state.hostId);
    $('player-count').textContent = `${state.players.length} / ${state.maxPlayers}`;
    $('players').replaceChildren(...state.players.map(player => {
      const item = document.createElement('li');
      item.value = player.seat + 1;
      item.textContent = `Seat ${player.seat + 1}: ${player.name}${player.id === state.hostId ? ' — Host' : ''}${player.id === playerId ? ' (you)' : ''}`;
      return item;
    }));
    $('empty').hidden = state.players.length > 0;
    $('player-name').disabled = Boolean(me) || pending;
    $('join').disabled = !socket.connected || Boolean(me) || pending || state.players.length >= state.maxPlayers;
    $('join').textContent = me ? 'Joined' : 'Join Game';
    $('start').hidden = !isHost;
    $('start').disabled = !socket.connected || pending || state.started;
    $('status').textContent = state.started
      ? 'Starting Alag Melkhii?'
      : me ? (isHost ? 'You are the host. Start when everyone has joined.' : `Waiting for ${host?.name || 'the host'} to start.`)
        : state.players.length >= state.maxPlayers ? 'The lobby is full.' : 'Enter your name and press Join Game.';
  }

  function request(event, payload) {
    pending = true;
    $('error').textContent = '';
    render();
    const done = (error, response) => {
      pending = false;
      if (error) $('error').textContent = 'The server did not respond. Reconnect or try again.';
      else if (!response?.ok) $('error').textContent = response?.error || 'The request was rejected.';
      else if (event === 'lobby:join') {
        rememberedName = payload.name.trim();
        try { sessionStorage.setItem('lan-player-name', rememberedName); } catch {}
      }
      render();
    };
    if (payload === undefined) socket.timeout(5000).emit(event, done);
    else socket.timeout(5000).emit(event, payload, done);
  }

  socket.on('connect', () => {
    $('connection').textContent = 'Connected to the LAN server.';
    $('error').textContent = '';
    pending = false;
    render();
  });
  socket.on('lobby:state', snapshot => { state = snapshot; render(); if (state.started && state.players.some(p => p.id === playerId)) location.replace('turtle.html?lan=1'); });
  socket.on('disconnect', () => {
    state = { players: [], maxPlayers: 12, hostId: null, started: false };
    pending = false;
    $('connection').textContent = 'Disconnected. Reconnecting… Your seat will be restored automatically.';
    render();
  });
  socket.on('connect_error', () => {
    $('connection').textContent = 'Cannot reach the LAN server. Check that it is running and this page uses port 3000.';
    render();
  });
  $('join-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('join').disabled) request('lobby:join', { name: $('player-name').value });
  });
  $('start').addEventListener('click', () => {
    if (!$('start').disabled) request('lobby:start');
  });
  render();
})();
