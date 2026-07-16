# Faceless Dancer Site

Single-box deployment scaffold with:
- Preact frontend
- Express + Postgres backend
- Solana signature auth + holder verification
- Bunny storage uploads
- Admin console APIs for reviewing submissions and downloading assets

## Workspace layout
- `client/` frontend app
- `server/` backend app
- `shared/` shared schemas/types

## Local development
1. Install dependencies:
   - `npm install`
2. Create env file:
   - copy `.env.example` to `.env`
3. Run migrations:
   - `npm run migrate`
4. Start dev servers:
   - `npm run dev`

### Local remote-generation smoke test

The local remote-generation path keeps the launch-server token on the site server:

`browser -> site API -> faceless-launch-server:4100 -> ACE-Step worker:8080`

For a host-run site server, set these values in the site's local `.env`:

```text
REMOTE_GENERATION_ENABLED=true
LAUNCH_SERVER_URL=http://127.0.0.1:4100
LAUNCH_SERVER_INTERNAL_TOKEN=local-development-token
```

The tracked `.env.docker` uses `http://host.docker.internal:4100` for the same connection when the site server runs in Docker. `docker-compose.yml` applies `LAUNCH_SERVER_URL_DOCKER` to the server container so a host-only `localhost:4100` value cannot accidentally point back at the container. The launch server must use the matching token.

### Deployed launch-server connection

For local final testing against the deployed launch server, set these values in the site's ignored `.env` before recreating the Docker server container:

```text
REMOTE_GENERATION_ENABLED=true
LAUNCH_SERVER_URL=https://launcher.facelessdancer.com
LAUNCH_SERVER_URL_DOCKER=https://launcher.facelessdancer.com
LAUNCH_SERVER_INTERNAL_TOKEN=<the same static INTERNAL_API_TOKEN configured on the launch server>
```

The production site's GitHub Actions `ENV_FILE` secret needs the same values. The internal token is consumed only by the site backend and is never a client-side `VITE_*` setting.

The temporary free test mode still opens the wallet approval prompt. It signs an intent-bound message instead of sending a zero-value token transfer; production/devnet FACELESS transfers remain a separate launch-server configuration.

## Docker (same-box production)
1. Set `.env` in repo root
2. Ensure persistent host dirs exist:
   - `sudo mkdir -p /var/lib/faceless-dancer/data /var/lib/faceless-dancer/beat-storage`
3. Start services:
   - `docker compose up --build -d --remove-orphans`
4. App endpoints:
   - frontend: `http://localhost:8080`
   - backend health: `http://localhost:3001/health`

Persistent storage uses absolute host paths outside the repo:
- `POSTGRES_HOST_PATH` (default `/var/lib/faceless-dancer/postgres`) -> Postgres data dir
- `BEAT_STORAGE_HOST_PATH` (default `/var/lib/faceless-dancer/beat-storage`) -> `/app/beat-storage`

Deployment/startup does not copy, reset, or replace persistent files.
Schema changes are explicit: run migrations manually when you choose.

One-time migration/import helpers:
- `npm run import:db --workspace server` (SQLite backup -> Postgres)
- `npm run import:beat-storage --workspace server` (local beat-storage backup -> Bunny prefix)

## API summary
- `POST /api/auth/nonce`
- `POST /api/auth/verify`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/submissions`
- `GET /api/submissions/me`
- `POST /api/submissions/:submissionId/assets`
- `GET /api/admin/submissions`
- `GET /api/admin/submissions/:submissionId`
- `POST /api/admin/submissions/:submissionId/status`
- `GET /api/admin/assets/:assetId/download`
