# Switch Game / Тоглоом солих

The host now has two distinct controls in both multiplayer game pages:

- **Шинээр эхлэх** resets the same game with the same party and, for Horse Racing, track length.
- **Тоглоом солих** opens game/track selection, confirms ending the current game, and creates a fresh game of the other type. Cancel does nothing.

No automatic deployment or new Render service is performed.

## Party and server authority

The existing server player map, assigned seats, host ID and session-token map are the persistent party for the lifetime of the server. Switching replaces only the active game object. Disconnected members remain in the party under the existing policy. Their tokens remain valid and no new players are created.

`game:switch` accepts only the active game ID, `targetGame` (`alag` or `horse`) and optional track configuration. The server verifies the connected session belongs to the party host, the request matches the current generation, there are at least two joined players (including retained offline members), and the target differs from the current game. Horse Racing requires a numeric 12/18/24 length. Unknown/forged player lists, seats, host identities, redirect fields and invalid settings are rejected. The roster comes exclusively from the server party map.

The replacement state is initialized without publishing intermediate snapshots, with connection status synchronized from live sockets and the first connected seat selected. The previous game is closed, its timers canceled and object removed from active routing. The server broadcasts `game:switched`, the new authoritative state and updated lobby/current-game metadata. Every new game has a new random UUID.

Alag starts with all 29 groups, zero scores, no eliminated players, dice, return mode, pending selection or winners. Horse Racing starts at zero positions with no results, ranking, finished racers or winner, using the selected track. Previously eliminated/finished players join the fresh game normally.

## Clients, reconnect and stale work

The shared session controller freezes old controls/MediaPipe requests, aborts animations and clears queued/pending work when switching. It accepts no arbitrary redirect URL: only known game IDs map to `turtle.html?lan=1` or `race.html?lan=1`. Guests receive a switching message and navigate automatically. Old state/acknowledgements cannot revive the previous game.

A player reopening an obsolete page is redirected after the server restores their identity and confirms the current party/game. The menu resume entry is built or updated from current server metadata, and informational localStorage game metadata is refreshed. Stored metadata is never used as authentication or as an arbitrary navigation URL. The token itself is unchanged.

Old-game rolls, selections, throws, restarts and switch requests are rejected. Closed game objects also reject delayed asynchronous work; timers are canceled and generation/closed-state guarded. Rendering, game rules, model assets, local MediaPipe processing, sounds and HTTPS/WSS transport are preserved.

## Exact local acceptance check

1. In `Mongol togloom 2/Alag-Melhii`, run `npm start` (`npm.cmd start` if required in Windows PowerShell).
2. Open `http://localhost:3000/lobby.html` in three separate browsers/profiles. Join Azaa first, Bat second, Dulguun third. Confirm seats 1/2/3 and Azaa as host.
3. Start Alag Melkhii and play several actions. Only Azaa should see enabled Restart and Switch Game controls.
4. Azaa opens **Тоглоом солих**, selects Horse Racing and length **12**. Cancel once: nothing changes. Reopen and confirm **Шинэ тоглоом эхлүүлэх** and the confirmation prompt.
5. All three pages must automatically enter Horse Racing without names/Join prompts. Check identical seats/names/host, all positions zero, empty ranking/results and Seat 1's turn.
6. Restart Horse Racing and verify track 12 is retained. Throw, then switch back to Alag while animation is active. All pages should show a fresh 108-bone board, zero scores, no pending dice/highlights and Seat 1's turn.
7. Restart Alag, then switch again using length 18 or 24. Verify both controls retain their distinct behavior.
8. Close Dulguun's page during Alag. Azaa switches to Horse. Dulguun reopens the same browser at the game menu/lobby and chooses **Тоглолтдоо буцаж орох**. Confirm the current Horse game, same Seat 3/token and no duplicate player. Directly reopening the obsolete turtle page must also lead to the current Horse game.
9. Confirm guests cannot switch or restart, including manually emitting `game:switch`. Old game IDs must be rejected rather than modifying the new game.

## Exact Render acceptance check

After the user deploys the committed changes to the existing single-instance Web Service:

1. Azaa, Bat and Dulguun open the same `https://YOUR-SERVICE.onrender.com/lobby.html` from different Wi-Fi/mobile networks and join in that order.
2. Repeat local steps 3–9, using the public HTTPS origin on all devices.
3. Check same-origin HTTPS/WSS, model/audio assets and camera permissions. Gestures from an old/transitional page must not throw in the new game.
4. Verify close/rejoin on the same browser and the new game resume destination. A server restart/redeploy still resets in-memory party/session data; switching games does not restart the server.

## Tests and limits

Run `npm test`; where runner child processes are sandbox-restricted, use `node --test --test-isolation=none tests/*.test.cjs`. The full suite includes both switch directions, host authorization, invalid/stale/forged requests, three-player identity preservation, fresh state, tracks, old timers/actions, reconnect into the new game, restart interoperability, client cancellation/navigation and dialog confirmation/cancel, plus all existing startup/gameplay/session/deployment regressions.

The application still has one in-memory party on one instance, no private room codes, and no recovery after server restart. Physical WebGL/camera/cross-network verification requires real browsers. Existing rendering behavior is unchanged by this feature; no fallback renderer is added or removed.
