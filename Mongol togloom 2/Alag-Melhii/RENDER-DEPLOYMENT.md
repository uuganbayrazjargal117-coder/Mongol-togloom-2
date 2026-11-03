# Render deployment

This app runs as one Node + Express + Socket.IO Web Service. No deployment has been performed. The repository-root render.yaml contains the nested application root and commands.

## Manual Render settings

- Service type: Web Service (not Static Site)
- Repository: your repository containing these files
- Branch: the branch containing this change
- Runtime / Language: Node
- Root Directory: Mongol togloom 2/Alag-Melhii
- Build Command: npm install
- Start Command: npm start
- Health Check Path: /healthz
- Environment variables: NODE_ENV=production, NODE_VERSION=22
- Instances: 1; do not enable autoscaling
- PORT: leave managed by Render

Choose the region and service plan in your Render account. Alternatively, create a Blueprint from the repository-root render.yaml and review the settings before deploying. If the app folder itself is your Git repository root, leave Root Directory blank and adjust rootDir in the blueprint accordingly.

Commit the server, package.json, package-lock.json, browser files, vendor files, models and assets. Do not commit node_modules or secrets. npm install supplies Express and Socket.IO; the Socket.IO browser bundle is served by the server. No client endpoint environment variable, CORS wildcard, custom TLS certificate or separate WebSocket service is needed. Render terminates HTTPS and forwards HTTP/WebSocket traffic to the same Node port. Both clients use io({auth: ...}) without a URL, automatically using the current origin and secure transport on HTTPS.

## Public verification after you deploy

1. Open https://YOUR-SERVICE.onrender.com on each device. Use the same domain on home Wi-Fi, a different Wi-Fi, and mobile data.
2. Choose Multiplayer Lobby or open /lobby.html; join with different names. The first joiner is host and can select Alag Melkhii or Horse Racing. Only the host can choose the Horse Racing track length (12, 18 or 24).
3. Start on the host. All joined tabs should navigate to /turtle.html?lan=1 or /race.html?lan=1 for the server-selected game, retaining names and seats. Seat 1 is current; other players cannot throw.
4. In Alag Melkhii, roll on Seat 1, take a highlighted group and check matching board removal, score updates and the next turn. Continue through automatic return/elimination and the final result; see ALAG-MULTIPLAYER.md. In Horse Racing, check matching four-shagai results, movement, turns and final ranking; see HORSE-MULTIPLAYER.md.
5. Refresh a game page and briefly interrupt a connection to verify session restoration. In browser Network tools, Socket.IO polling uses HTTPS and WebSocket upgrades use WSS, with no mixed-content requests.
6. Enable the camera and grant browser permission. Confirm hand detection runs locally; no camera stream is uploaded. HTTPS enables camera APIs, subject to browser/device permission and support. Confirm Three.js, model, WASM and audio requests succeed.

## Local use and tests

From the application folder run npm install, then npm start. Open http://localhost:3000. PORT optionally overrides 3000. Windows PowerShell users with script execution restrictions can use npm.cmd instead of npm.

Run npm test. In environments that block test-runner subprocesses, use node --test --test-isolation=none tests/*.test.cjs.

## Existing limitations

Alag Melkhii now supports multiplayer rolls, validated group selection, board presence, scoring, automatic returns, elimination, subsequent turns and winners/ties using the existing local rules. Direct turtle.html still offers local play. Horse Racing supports multiplayer throws, movement, subsequent turns, finish and full ranking using the existing rules; direct race.html still offers local play. Server validation ignores client-supplied identities, seats, random results, scores and winner claims; session tokens are server-issued bearer credentials kept in per-tab sessionStorage. Camera processing and video stay in the browser.

There is one shared lobby/game, up to 12 players, with no private room codes. Anyone with the public URL can join available seats. Keep one server instance: state and sessions live in memory, without a shared store or Socket.IO adapter. Restart, redeploy or instance replacement resets them. A started game retains its roster when players leave and cannot be reset through the UI; restart the service for a new game. Alag Melkhii preserves an offline player's pending turn until reconnect; it does not eliminate players for disconnecting. Horse Racing broadcasts offline status and skips disconnected racers after a reconnect window; all-offline unfinished races wait for a reconnect. A sleeping/stopped instance can interrupt play. Production HTTPS/WSS, camera permission and cross-network connectivity require verification on the actual public domain after deployment.

Official references:
- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/websocket
- https://render.com/docs/blueprint-spec
