# Alag Melkhii LAN Stage 2

Start the server from this directory with npm.cmd start (Windows PowerShell).
Use the LAN address printed by the server on both computers, on the same Wi-Fi.

1. Open http://HOST_IP:3000/lobby.html on computer A, enter a name and Join Game. This player is host and Seat 1.
2. Open the same URL on computer B, enter a different name and Join Game. Check both names and seats on both screens.
3. Check B has no Start Game control. Press Start Game on A.
4. Both browsers automatically open turtle.html?lan=1 without joining again. Check names, seats, scores (zero), You labels, and Seat 1 as current player.
5. Check only Seat 1 can roll. Press its roll button once. Both screens use the existing CSS dice animation and settle on the same value; identical eligible groups glow on both boards.
6. Both roll buttons remain disabled after the roll. Group buttons and board selections do not change the board in Stage 2.
7. Refresh either game page: its identity, seat, game and rolled value should be restored. Try briefly disconnecting Wi-Fi and reconnecting.

Automated tests: npm.cmd test. Where process spawning is restricted, use node --test --test-isolation=none tests/lobby.test.cjs.

The server owns roster, current player/seat, score and eliminated fields, dice, started/finished flags, game ID and roll sequence. Session tokens are private bearer credentials stored per browser tab. Page navigation opens a new transport socket and restores the original logical player identity. Clients cannot supply a roll value or another player's identity to authorize actions.

Scope ends at the first roll and eligible highlighting. Selection, return, elimination, winner logic and subsequent turns are deferred. Scores stay zero and Seat 1 remains current. Restart the Node server and return both browsers to the lobby for a fresh game. A started roster is retained even when players disconnect; there is no timeout forfeiture or host migration during a game. Before starting, disconnected seats are reserved for 15 seconds. Server restarts lose in-memory sessions. Use one player tab per computer; a new tab has a separate session.

Horse Racing, MediaPipe tracking, Three.js board rendering and bone.json are unchanged. Offline Alag Melkhii retains its existing local rules. Physical two-computer and visual browser verification must be performed using the steps above.
