# Complete Alag Melkhii multiplayer

## Root cause and fix

The previous Stage 2 implementation intentionally stopped after rolling: `select()` returned immediately in multiplayer, choice buttons were disabled, and the server stored no logical board or selection handler. Selection is now enabled through `game:select`, validated and committed by the server. Both eligible-choice buttons and the existing Three.js raycast use the same request path. No group is hidden and no score is awarded optimistically.

## Shared IDs and authoritative state

`alag-rules.mjs` defines the existing 29 logical groups totaling 108 bones, each with a stable ID (for example `head`, `eyes`, `back-1`). Names, counts and order match the original board. `game.js` attaches the matching ID to its existing visual group; the original positions, colors, geometry and meshes remain browser-side. The shared eligibility function is used by both local play and the server.

`alag-game.cjs` owns group presence, scores, eliminated players, current player/seat, turn number, dice and roll sequence, eligible IDs, mode, last roll/action, finish reason and winner IDs. Socket.IO broadcasts plain snapshots. Restoring a group toggles the same existing meshes visible; it never creates duplicate models.

Requests carry game ID and turn number. Selection additionally carries roll sequence and group ID. The server checks socket/session membership and connection, current turn, elimination/finish status, an existing pending roll, known group ID, present status, matching quantity and server eligibility. Duplicate, stale, unknown, removed and wrong-value groups are rejected. Client-supplied scores, identities, dice, board presence and winner claims are ignored.

A successful take removes that group, adds its quantity to the current player's score, clears the pending roll and eligibility, and advances to the next non-eliminated player. Server-generated dice remain 1–6 using Node crypto. `lastRoll` preserves the actual result for animation even when an automatic return/elimination has already cleared the pending roll.

## Original rules preserved

- If there is a present matching group, the current player chooses one whole group to take.
- If no present group matches, the original local code automatically restores the **first absent matching group in board order**, provided the current player can afford its value. The server performs that return and score deduction automatically. There is no new manual return-choice step and no ownership requirement for the restored group.
- If the required return is unaffordable, the player is eliminated. Eliminated players keep their existing collected score and are skipped on subsequent turns.
- If elimination leaves at most one non-eliminated player, that remaining player wins, regardless of highest score. If none remains, there is no winner.
- If a take clears the board, all non-eliminated players tied for highest score win. Scores and winners come from the server.

The client serializes dice animations and incoming state, disables actions during rendering/pending requests, and restores a historical die pose without rerolling on refresh. Highlighting uses server-approved IDs for everyone, while only the current non-eliminated player can submit a selection. Direct `turtle.html` without `?lan=1` retains local play.

## Exact local acceptance check

1. In `Mongol togloom 2/Alag-Melhii`, run `npm install`, then `npm start`. On Windows PowerShell, use `npm.cmd` if needed.
2. Open `http://localhost:3000/lobby.html` in two separate browsers/private browser sessions. Join as Azaa first, then Bat. Confirm matching names/seats.
3. As host, choose **Алаг мэлхий** and press Start Game. Both browsers should navigate to `turtle.html?lan=1`, without joining again.
4. Only Azaa/Seat 1 can roll. Roll once. After the existing dice animation, check that both clients display the same value and highlight the same groups.
5. As Azaa, click one highlighted mesh or its choice button. The exact group must disappear on both clients, Azaa's score must increase by its quantity, highlighting must clear, and Bat must become current. Rapid double clicks must award the group only once.
6. Roll as Bat and repeat. Azaa must see highlights but cannot take Bat's group. When a 3 is rolled, the eligible present groups are the head, tail and metal (`Толгой`, `Сүүл`, `Төмөр`). Production dice are random; automated tests cover this exact 3-roll scenario without adding a client dice override.
7. Refresh during a pending selection and after taking groups. Check that seat, name, scores, missing groups, current turn, die and eligibility remain correct. Only the current player can resume the action.
8. Continue until a value has no present matching group. The server should restore the first absent matching group and deduct its value, or eliminate a player who cannot afford the return. Every browser must show the same score, restored group and elimination status.
9. Continue to board clearance or last-player victory. Every browser must display identical final scores and winners. An all-highest-score tie must show all tied winners.
10. Restart the server for a fresh lobby and verify Horse Racing still starts and plays as before. Open `turtle.html` directly to verify local setup, taking and turn behavior.

## Exact Render acceptance check

No automatic deployment is performed. After you deploy these files using the existing single-instance Render Web Service:

1. Player A on home Wi-Fi opens `https://YOUR-SERVICE.onrender.com/lobby.html` and joins first.
2. Player B on a different Wi-Fi or mobile network opens the identical public URL and joins.
3. A chooses Alag Melkhii and starts. Repeat local steps 4–9 on those two devices.
4. Check that Socket.IO uses the same HTTPS origin/WSS, with no mixed-content asset requests. Enable the camera and grant permission on each browser; a current player's local gesture should request a roll, while a non-current player's gesture should do nothing. No video should be uploaded.
5. Refresh/reconnect a player during a pending roll/selection and verify complete board/score restoration. For another game, restart the service and return both browsers to the lobby.

## Automated validation

Run `npm test` in the application folder. If the development sandbox blocks child processes, use `node --test --test-isolation=none tests/*.test.cjs`.

The tests use real Socket.IO clients for selection authority, duplicate/stale/forged actions, synchronized boards/scores, automatic return/deduction/restoration, elimination, wins, ties and refresh. They also run the actual local `game.js` handlers without WebGL and compare every logical transition in return/elimination and full-board games against the server. Controller tests cover control gating, dice serialization, mesh visibility restoration, and the existing raycast callback forwarding a stable group ID without local score/removal. The complete suite includes the original roll/session tests, Horse Racing and deployment tests.

Physical visual, camera and cross-network acceptance still requires the browsers/devices above; automated logical tests do not replace it.

## Existing limits

State and sessions remain in memory on one server instance. A restart/redeploy resets the game. There is one shared lobby, no private rooms, and no multiplayer reset/rematch UI. An Alag Melkhii player who disconnects retains their turn and must reconnect to continue; disconnection does not invent a new elimination rule. Slow/background clients may finish their dice animation later and then catch up to the latest snapshot. Horse Racing's existing disconnect policy is unchanged.
