# Multiplayer startup, resume and restart

## Findings and remaining device diagnosis

The original generic “3D дүрслэл ачаалсангүй” catch did not identify whether WebGL context creation, bone.json transport/JSON, mesh construction or later setup failed. The controller already cached early state, so an early state message by itself was not proof of the reported device-specific failure. The actual failing-device console stack is still required before claiming its exact graphics root cause is fixed. No failing-device stack was supplied with this change.

The new initializer reports the original exception and stack under `[Alag:init:webgl]`, `[Alag:init:bone-fetch]`, `[Alag:init:bone-json]`, `[Alag:init:mesh-creation]`, `[Alag:init:board-setup]` or `[Alag:init:render-start]`. The model URL is relative to the same-origin module. Session/connection/control/state-application errors have separate `[multiplayer:...]` diagnostics and are not relabeled WebGL errors. Tokens are never logged.

The full Alag initializer is regression-tested in all six permutations of session, authoritative state and model readiness, using actual bone.json and Three.js geometry with a stub GPU renderer. Each produces exactly 29 groups and 108 model instances. These tests do not validate a physical device's GPU/WebGL implementation.

The first roll is enabled only after socket connection, server session identity, game state, model/mesh readiness and successful state application, and only for the current non-eliminated player with no pending action. The old generic failure left rendering readiness false and therefore also left the host's roll disabled; this is a consequence of a failed initializer, not a reason to globally enable controls. Online initialization now avoids the local-game reset path and exposes independent readiness flags through the controller.

Alag picking previously considered every visible bone, so a nearer non-interactive group could intercept a highlighted group's click. Multiplayer picking now targets only server-eligible groups available to the local current player and includes their visible outline geometry. Both mesh and choice-button actions still send only validated logical IDs; no optimistic score/removal occurs.

## Persistent resume

The previous tab-only sessionStorage could not reliably restore a player after closing the tab. The same cryptographically random server-issued token is now persisted in localStorage, with compatibility for existing tab storage. A fresh page in the same browser can restore the same server-side player ID, name, seat, score, elimination and board state. Use separate browsers/profiles/private sessions for distinct players on one computer.

The game menu and lobby offer **Тоглолтдоо буцаж орох** after the server confirms the saved identity. Resume does not join another player. Refresh of the game page restores current state directly. An invalid/expired token is cleared and cannot authorize another player's actions; identity/seat/name fields supplied by clients are not authentication.

Started-game seats are retained. An offline Alag current player has a 15-second grace period after the server detects disconnect; if still offline, the server clears that pending roll/eligibility and passes the turn without changing score, board ownership or elimination. Subsequent turns skip offline players. If no eligible player is online, the game waits and resumes when a player returns. Horse Racing retains its existing reconnect/skip behavior.

Storage alone is not durable server state: a server restart/redeploy still loses all in-memory games and tokens. Reopening a different browser/profile or clearing site data cannot recover a lost token.

## Authoritative restart

Only the restored host sees an enabled **Шинээр эхлэх** button. Confirmation text is **Тоглолтыг эхнээс нь эхлүүлэх үү?**. Cancel sends no request. Confirm sends `game:restart` with the active game ID; the server checks the live socket/session against its own host ID. Guest and stale restart requests are rejected.

Alag restart restores all 29 groups, clears scores, elimination, pending dice, eligibility, return mode and winners. Horse restart clears positions, results, ranking, finished racers and winner while retaining the selected 12/18/24 track. Names, seats, tokens, host identity and connectivity remain. The first connected seat becomes current. No lobby navigation or second join is required.

Every restart receives a fresh game UUID. Old roll, select, throw and restart requests cannot validate against it. Server animation/disconnect timers are canceled and generation-guarded. Clients retire old IDs, abort old animation work, clear pending requests and ignore old acknowledgements. Old async continuations check their cancellation signal before touching the new board/positions. Alag reuses its existing meshes; racing reuses its board when the roster and track are unchanged.

## Local acceptance

1. From `Mongol togloom 2/Alag-Melhii`, run `npm start` (`npm.cmd start` if PowerShell requires it). Open `http://localhost:3000/lobby.html` in two separate browsers/profiles.
2. Join A first (host/Seat 1), then B. Select Alag and start. Confirm both show the entire 108-bone board, correct names/seats, identical turn and zero scores. Only A can roll and restart.
3. A rolls; both show the same dice/highlights. A clicks an eligible bone, its outline or its choice button. Both remove the same group, award the same score and pass the turn. Check rapid clicks do not duplicate scoring.
4. Close B's page during the unfinished game. In the same browser, open `http://localhost:3000` or the lobby, choose **Тоглолтдоо буцаж орох**, and verify B returns to the same seat without entering a name. Check refresh also restores current board and scores.
5. Leave the current player offline beyond the grace period. Confirm the other player can continue, with the offline player's seat/score retained. Return that player and verify subsequent turns work.
6. As A, press restart, cancel once, then confirm. Both boards/scores/dice reset without leaving the game. Check only A may restart, including while a roll/selection is pending.
7. Start a Horse Racing session from a fresh server/lobby, choose a track and repeat gameplay, close/rejoin and host restart, including during shagai/horse animation. Confirm positions/ranks/results clear and the track remains unchanged.
8. On any rendering failure, preserve the console's first error and stack, device/browser details and model request status. Send that trace before concluding the reported device graphics fault is resolved.

## Render acceptance

Nothing is deployed automatically. After the user deploys these files using the existing single-instance Render settings:

1. A opens `https://YOUR-SERVICE.onrender.com/lobby.html` on Wi-Fi; B opens the same public URL on a different Wi-Fi/mobile network.
2. Repeat local steps 2–6, reopening the same public origin for resume. Confirm HTTPS/WSS, same board/state, current-only actions and host-only restart.
3. Repeat step 7 for Horse Racing, checking 12/18/24 track preservation as needed.
4. Enable each camera with permission; recognized gestures must still request only the current player's throw. No video is uploaded.
5. Collect the failing device's actual console stack for the remaining graphics diagnosis. GPU/camera/physical-network acceptance cannot be inferred from the automated logical tests.

## Automated tests

Run `npm test`. Where the sandbox prohibits runner child processes, run `node --test --test-isolation=none tests/*.test.cjs`.

Coverage includes full initializer permutations and staged failures, exact mesh counts, host/guest control readiness, Alag raycast eligibility, authoritative selection/scoring/returns/elimination/ties, restart authentication, full reset state, track preservation, generation/timer/animation/acknowledgement isolation, persistent token storage, invalid tokens, close/rejoin, disconnected-turn skipping, Horse Racing and deployment regressions.
