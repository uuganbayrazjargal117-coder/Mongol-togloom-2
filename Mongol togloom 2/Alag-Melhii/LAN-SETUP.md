# Stage 1 LAN lobby

Run all commands from the application root, `Mongol togloom 2/Alag-Melhii` (the folder containing `server.js` and `index.html`).

## Install and start on the host computer

1. Install Node.js 22 or newer from https://nodejs.org/ (npm is included). Reopen your terminal after installation.
2. Run `npm install`.
3. Run `npm start`. Leave the terminal open. Stop the server with Ctrl+C.
4. Open http://localhost:3000 and choose **LAN Multiplayer Lobby**, or open http://localhost:3000/lobby.html directly.

The server listens on `0.0.0.0:3000` and prints candidate LAN IPv4 addresses. `0.0.0.0` is a listening address, not the address to enter in another computer's browser.

## Find the host's address on Windows

Open PowerShell or Command Prompt and run `ipconfig`. Under the active Wi-Fi or Ethernet adapter, find **IPv4 Address**, for example `192.168.1.25`. Use that adapter's address rather than a VPN, virtual adapter, or disconnected adapter.

On another computer connected to the same Wi-Fi/LAN, open `http://192.168.1.25:3000` (substitute the actual host IPv4) and choose **LAN Multiplayer Lobby**. Only the host needs Node.js or the source files; other computers need a browser.

If Windows Firewall prompts for Node.js access, allow it on your trusted Private network. If connection fails, check the host's inbound TCP port 3000 access, the IP address, and whether the router uses guest-network/client isolation. Do not configure internet port forwarding.

## Lobby behavior

- Enter a name of 1–30 characters and click **Join Game**. Each joined browser connection receives its Socket.IO ID and a zero-based seat index (displayed as seats 1–12).
- All connected lobby browsers see the current player list. Browsers that have not joined do not occupy a seat.
- The first player to join becomes host. Only the host sees **Start Game**; the server also rejects unauthorized start requests.
- Start Game broadcasts a started status only. It does not launch or synchronize either existing game. Players may still join after this stage-one status is set.
- Disconnecting frees the seat. Host control transfers to the earliest remaining joiner; existing players retain their seats.
- Refreshing or reconnecting creates a fresh socket identity. The name is remembered per tab, but the player must click Join Game again; their old seat and host role are not reserved.
- When all joined players disconnect, the lobby resets. Restarting Node.js also resets it. No data is persisted.
- The original game links continue to launch local games. This stage adds no dice, turns, scores, selections, movement, camera, or rendering synchronization.

## Two-computer check

1. Start the server on computer A and open the lobby. Join as Alice. Confirm seat 1 and Host.
2. On computer B, open `http://HOST_IP:3000/lobby.html`. Join as Bob.
3. Verify both browsers immediately show Alice and Bob with the same seat numbers. Only Alice sees Start Game.
4. Click Start Game on A. Verify both show the started status and remain in the lobby.
5. Close A's lobby tab. Verify Bob remains listed and becomes Host on B.
6. Reopen the lobby on A and join again. Verify the list updates on both computers, with Bob still host.
7. Close all joined lobby tabs, then reopen to verify a fresh lobby. Open the original game pages and confirm they still work locally.

For an automated server and Socket.IO check, run `npm test`. It tests static serving, join validation, synchronized state, host authorization, the 12-player cap, seat reuse, host transfer, and lobby reset using real Socket.IO clients. It does not test a physical LAN or browser graphics.
