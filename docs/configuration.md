# Configuration

All settings are environment variables. With Docker they go into `.env` next to `docker-compose.yml`; [.env.example](../.env.example) lists every option with its default. `.env` is ignored by git, so secrets are safe there.

After changing `.env`, apply it with `docker compose up -d` (a restart alone does not re-read the file).

## Required

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | Encrypts the database and stored files. At least 32 characters; generate one with `openssl rand -hex 32`. Cannot be changed later. See [Encryption](encryption.md). |
| `ENCRYPTION_KEY_FILE` | Alternative to `ENCRYPTION_KEY`: path of a file that holds the key, e.g. a Docker secret (`/run/secrets/magpie_key`). |

The key is only required when `NODE_ENV=production`, which the Docker image sets. In local development the app runs without it and logs a warning.

## Container

| Variable | Default | Description |
|---|---|---|
| `TZ` | `UTC` | Time zone of the container (log timestamps). |
| `MAGPIE_PORT` | `8085` | Port on the host the app is published on (used by `docker-compose.yml`). |

## Accounts and sessions

| Variable | Default | Description |
|---|---|---|
| `ALLOW_REGISTRATION` | `true` | Allow public sign-up. When `false`, only the very first account (the admin) can register; admins create everyone else under **Users**. |
| `BASE_URL` | – | Public address of the app, e.g. `https://magpie.example.com`. Needed for [sign-in with GitHub/OIDC](sign-in.md). If it starts with `https://`, session cookies are marked `Secure`. |
| `COOKIE_SECURE` | auto | Force the `Secure` cookie flag on or off. |
| `SESSION_DAYS` | `30` | How long a login lasts. Using the app extends it. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy, so client IP addresses (used for rate limiting) are correct. |

## Notes

| Variable | Default | Description |
|---|---|---|
| `TRASH_DAYS` | `30` | Items in the trash are deleted permanently after this many days. |

## Link previews

| Variable | Default | Description |
|---|---|---|
| `LINK_PREVIEWS` | `true` | Fetch page information (title, description, image, …) for link notes. `false`: the server never contacts linked sites. |
| `LINK_PREVIEW_ALLOW_LAN` | `false` | Allow previews of private and LAN addresses (`192.168.x.x`, `10.x`, `localhost`, …). Off by default so users can't make the server probe your internal network. Turn it on if you save links to your own self-hosted services. |
| `FLARESOLVERR_URL` | – | Address of a [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) instance, e.g. `http://192.168.1.10:8191`. Pages that refuse link previews (HTTP 401/403/429/503, a "checking your browser" page, a dropped connection), and shop pages whose price only appears in a browser, are fetched through it. It does not get past every bot protection: some shops (e.g. Walmart, Best Buy) block it too, and their links get a partial preview built from the address. Private addresses are still refused unless `LINK_PREVIEW_ALLOW_LAN` is on. |

## Sign-in providers

| Variable | Default | Description |
|---|---|---|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | – | Turn on "Sign in with GitHub". |
| `GITHUB_URL`, `GITHUB_API_URL` | github.com | Only for GitHub Enterprise Server. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | – | Turn on sign-in with an OpenID Connect provider. Leave the secret empty for a public client (PKCE only). |
| `OIDC_NAME` | `Single sign-on` | Provider name on the button ("Sign in with Authentik"). |
| `OIDC_SCOPES` | `openid profile email` | Scopes requested from the provider. |

Setup instructions: [Sign in with GitHub or OpenID Connect](sign-in.md).

## Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |

## Set by the Docker image

Only change these when running [without Docker](installation.md#running-without-docker).

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Address the server listens on. |
| `PORT` | `3000` | HTTP port inside the container. |
| `DATA_DIR` | `/data` | Folder for the database and stored files. |
| `DATABASE_PATH` | `<DATA_DIR>/app.db` | Database file. |
| `WEB_DIST` | bundled | Folder of the built web app. |
| `LIVE_HEARTBEAT_MS` | `25000` | Interval of keep-alive messages on the live-update stream. |
