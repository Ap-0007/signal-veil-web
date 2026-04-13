# Signal Veil Web

Anonymous encrypted room chat for the web.

## Local Run

```bash
cd /Users/amogh/Documents/anon-web-chat
npm test
npm start
```

Then open `http://localhost:8080`.

## Deploy

This app is a static frontend plus a small Node server for room state and realtime relay.

### GitHub First

```bash
cd /Users/amogh/Documents/anon-web-chat
git init -b main
git add .
git commit -m "Initial Signal Veil web app"
git remote add origin https://github.com/YOUR_USERNAME/signal-veil-web.git
git push -u origin main
```

### Render

Use:

- Push the repo to GitHub.
- In Render, choose `New +` -> `Blueprint`.
- Select the repo.
- Render will read [render.yaml](/Users/amogh/Documents/anon-web-chat/render.yaml) and create the web service.
- After the first deploy, share the Render URL.

Manual settings if you do not use the blueprint:

- Start command: `npm start`
- Node version: `22`
- Environment variable: `HOST=0.0.0.0`
- Health check path: `/health`

### Railway

### Docker

```bash
docker build -t signal-veil-web .
docker run -p 8080:8080 signal-veil-web
```

## Security Model

- No accounts.
- The room secret is intended to be shared in the URL hash so it is not sent to the server.
- The server stores only ciphertext, nonces, room IDs, timestamps, and anonymous client IDs.
- Rooms live in memory only and expire after inactivity.

## Limits

- This is not a Bluetooth web app. It is the closest deployable browser equivalent: anonymous encrypted room chat.
- Server memory is ephemeral. Restarting the process clears rooms.
