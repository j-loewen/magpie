# Installation

Magpie runs as a single Docker container. All data (the database and stored files) lives in one folder on the host, encrypted with a key you choose.

## Requirements

- Docker with the Compose plugin (`docker compose`)
- For sign-in with GitHub/OIDC and for installing the app on phones: a domain with HTTPS (see [Reverse proxy and HTTPS](reverse-proxy.md))

## Install

1. **Get the code**

   ```sh
   git clone https://github.com/j-loewen/notes.git magpie
   cd magpie
   ```

2. **Create the configuration**

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

3. **Set the encryption key.** It is required: the app does not start without it.

   ```sh
   openssl rand -hex 32
   ```

   Put the output into `.env` as `ENCRYPTION_KEY=…`. **Store a copy of the key somewhere safe, away from the server** (a password manager, for example). Without it your notes cannot be read, and it cannot be changed later. See [Encryption](encryption.md).

4. **Adjust the rest of `.env`.** At least:
   - `BASE_URL`: the public address, e.g. `https://magpie.example.com`
   - `TZ`: your time zone, e.g. `Europe/Berlin`
   - `MAGPIE_PORT`: the port on the host (default `8085`)

   All options are listed in [Configuration](configuration.md).

5. **Start it**

   ```sh
   docker compose up -d --build
   ```

6. Open `http://<host>:8085` and **register. The first account becomes the admin.**

7. If only people you invite should get in, set `ALLOW_REGISTRATION=false` in `.env` and run `docker compose up -d` again. As admin you then create accounts under **Users** in the user menu.

## Where the data is

`docker-compose.yml` mounts `./data` (next to the compose file) into the container:

| Path | Contents |
|---|---|
| `data/app.db`, `app.db-wal`, `app.db-shm` | The database: notes, folders, accounts, logins. Encrypted. |
| `data/files/<note id>/` | Link preview images and site icons, one folder per note. Encrypted. |

To back it up, see [Backing up and restoring](backups.md).

## Changing settings

Edit `.env`, then apply it with:

```sh
docker compose up -d
```

A plain `docker compose restart` does not re-read `.env`.

## Updating

```sh
git pull
docker compose up -d --build
```

Database changes are applied automatically when the new version starts. Make a [backup](backups.md) first.

## Health check

The container reports its health to Docker (`docker ps` shows *healthy*). The same check is available at `GET /api/health` for external monitoring.

## Running without Docker

Requires Node.js 22 or later.

```sh
npm ci
npm run build
NODE_ENV=production ENCRYPTION_KEY=<your key> DATA_DIR=/var/lib/magpie PORT=3000 \
  node apps/server/dist/index.js
```

The server serves the web app itself (from `apps/server/dist/public`). The other settings are the same environment variables as in Docker, see [Configuration](configuration.md).
