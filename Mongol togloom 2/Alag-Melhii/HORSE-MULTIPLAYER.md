# Horse Racing multiplayer

The existing shared lobby now starts either Alag Melkhii or Horse Racing. The first joiner is host. Only the host may change the selected game or choose a Horse Racing track length of 12, 18 or 24 before starting. Everyone sees the server-approved settings. Start broadcasts the selected game and game ID. The browser maps the approved game ID to a fixed local page, never a client-provided redirect.

## Server authority and existing rules

`horse-game.cjs` stores only plain logical state: game ID/type, names/IDs/seats, connection status, current player and seat, turn number, track length, positions, finished racers, four shagai faces, last throw/movement, animation phase, ranking, winner and started/finished flags. Three.js objects remain browser-side.

The browser sends `horse:throw` with the current game ID and turn number. The server uses the socket's restored session identity, verifies membership, connection, current turn and phase, and ignores client-supplied faces, movement, position, seat or ranking. Accepted requests lock the turn immediately. Replays of previous turn numbers and duplicate requests during animation are rejected.

The server generates exactly four face indices using Node's `crypto.randomInt(0, 4)`: 0 horse, 1 camel, 2 sheep, 3 goat. It directly imports the unchanged `advance()` from `race-logic.mjs`: advance by horse-face count, or four spaces for four distinct faces; cap at the track length. This same function still serves local play.

The server broadcasts the exact faces and resulting positions. Each browser uses the existing throw animation, sound and horse movement animation. The client controller serializes animation work and applies the latest server snapshot after delayed rendering; duplicate snapshots do not replay a throw. Animation decisions use the server phase, avoiding dependency on matching device clocks.

Seat 1 (the lowest occupied seat if the lobby has gaps) starts. A 4-second server animation window covers the existing 2650ms throw and 800ms movement plus margin. Then the server advances to the next connected, unfinished racer. Clients cannot advance the turn or hold the race up by withholding an animation acknowledgement. A delayed/background browser catches up from snapshots before enabling its controls.

When a position reaches the finish, the server marks that racer finished and appends its ID to ranking once. The first finisher is the winner. Remaining racers continue; finished racers are skipped. The race finishes when every racer has finished. All clients display the same positions and ordered ranking.

## Identity, camera and disconnects

The lobby and race share the existing per-tab, server-issued session token. Navigation opens a new transport socket but restores the same logical player ID, name and seat without joining again. Use one player per tab/device. The UI shows names, seats, You, positions, current turn, ranks and offline status.

The shared MediaPipe detector/model is unchanged. A local recognized gesture invokes the same turn-validated throw request as the button; a non-current player's gesture cannot submit a throw. Video processing stays in the browser and is never uploaded.

Disconnect status is broadcast immediately. An idle current player gets up to 15 seconds to reconnect before being skipped. During a throw, the normal animation timer advances to the next connected racer. If everyone unfinished is offline, the race waits and resumes when someone reconnects. Offline racers keep their positions and can rejoin later; they are not automatically awarded a finishing rank.

## Exact local check

1. Open a terminal in `Mongol togloom 2/Alag-Melhii`. Run `npm install`, then `npm start` (or `npm.cmd` in Windows PowerShell if required). Open `http://localhost:3000/lobby.html`.
2. Join as Azaa. Open a separate private browser window or another browser at the same URL and join as Bat. Confirm names/seats match and only Azaa has Start Game and enabled settings.
3. On Azaa, choose **Морь уралдуулах** and track **12**. Confirm Bat immediately sees the same settings and cannot change them. Track options 18 and 24 should also synchronize before starting.
4. Press Start Game on Azaa. Both should enter `race.html?lan=1`, show the same track and seats, mark the local player as You, and show Seat 1's turn. There is no second join or local setup dialog.
5. Only Seat 1's throw button should be enabled. Throw and confirm both screens animate the same four faces and move the same racer by the same amount. After about four seconds, the next player can throw. Try rapid double clicks; only one throw is accepted.
6. Continue to the finish. Confirm four distinct faces advance four spaces, no racer goes past the finish, finished racers stop taking turns, and both clients show the same final ranking.
7. Refresh one race page mid-race. Confirm identity, seat and positions are retained. Close the current player's tab while idle; the other player should gain the turn after the reconnect grace period. Reopen the same session to recover the offline racer. Temporarily disconnect/reconnect to check offline status and recovery.
8. Enable the camera, grant permission and perform a throw gesture on the current player. It should behave like the button. A gesture on the other player must not throw.
9. Restart the Node server and return both browsers to the lobby for a new game. Choose **Алаг мэлхий**, start, and confirm the existing synchronized dice/highlighting still works. Direct `race.html` without `?lan=1` retains the original local game setup and rules.

## Exact Render check with different networks

No deployment is performed by this change. After you deploy the committed files through your existing Render Web Service, keep the existing Node runtime, application root, `npm install`, `npm start`, `/healthz`, and **one instance** configuration.

1. On device A on home Wi-Fi, open `https://YOUR-SERVICE.onrender.com/lobby.html` and join first.
2. On device B on another Wi-Fi or mobile data, open the identical public URL and join. A third player can join from another network before starting.
3. Repeat local steps 3–8 above using these devices. Confirm automatic navigation, host-only settings, matching faces/movement/turns, and final ranking.
4. In browser network tools, confirm Socket.IO uses the same HTTPS origin and WSS when upgraded, and the race model, audio, modules and MediaPipe assets load without mixed-content errors. Camera permission must be granted on each device. Camera video should produce no upload requests.
5. Refresh a page and briefly interrupt a player's network to verify recovery. Public-domain/camera and physical cross-network checks require the actual deployment and devices.

## Automated validation

Run `npm test` from the application folder. In a sandbox that blocks test-runner child processes, run `node --test --test-isolation=none tests/*.test.cjs`.

The suite covers host-only game/track selection, synchronized start, identity restoration, Seat 1, valid server-generated faces, movement including bonus/zero/capping, duplicate/out-of-turn/forged requests, subsequent turns and finished-racer skipping, full synchronized ranking, disconnects/all-offline recovery, client animation queuing and control gating, Alag Melkhii regression tests, and Render/static-asset regressions. Deterministic test RNG and short timers are injected only by server-side tests; production uses crypto RNG and the normal durations.

## Remaining limits

- One shared lobby/game, up to 12 players, no private rooms or account system.
- In-memory state/session storage: server restart, redeploy or instance replacement resets the game. Keep one instance; no cross-instance shared store is added.
- No multiplayer rematch/reset UI. Restart the server/service and return to the lobby for a fresh game.
- A connected player who never throws has no idle timeout. Disconnected players are skipped, retain their positions and need to reconnect to finish; all-offline unfinished races wait.
- Slow/background browsers may finish their local animation later than other devices; authoritative results, positions and turns remain shared. Browser audio permission/autoplay restrictions still apply.
- Alag Melkhii remains Stage 2, ending at dice/highlighting. No later Alag Melkhii stage is implemented.

Automated server/controller tests are separate from physical browser graphics, camera and cross-network acceptance checks. A headless Edge graphics check was attempted in the development sandbox, but the browser could not run reliably under its process restrictions; perform the visual steps above on real browsers.
