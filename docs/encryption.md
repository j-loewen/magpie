# Encryption

Everything Magpie stores on disk is encrypted with your `ENCRYPTION_KEY`. Without the key, the files in `./data` are random bytes.

## What is encrypted

| Data | Where | How |
|---|---|---|
| Notes, folders, accounts, password hashes, logins, sharing, settings | `data/app.db` and its write-ahead log `app.db-wal` | The whole database file, in the SQLCipher 4 format (AES-256, key derived with PBKDF2). |
| Link preview images and site icons | `data/files/` | Each file with AES-256-GCM, using a key derived from the same secret. A file that was changed on disk is detected and not served. |

Not encrypted: zip exports that users download (Settings → Import & export). Those are meant to be readable.

## What it protects against

- Someone gets a copy of `./data`: a stolen or discarded disk, a backup on another machine or in the cloud, a leaked Docker volume. They see nothing without the key.
- Files in `data/files` being swapped or altered on disk.

## What it does not protect against

- **Someone with root access to the Docker host.** The running app has to know the key, so anyone who controls the host can read it: from `.env`, from `docker inspect`, or from the process. Encryption at rest is not a defence against a compromised server.
- **People with access to the app.** Encryption is invisible to logged-in users. Who can see which notes is decided by accounts, [sharing](user-guide.md#sharing) and [private folders](user-guide.md#private-folders).

To keep the key away from casual access:

- Make `.env` readable only by you: `chmod 600 .env`.
- Or use a Docker secret and `ENCRYPTION_KEY_FILE`:

  ```yaml
  # docker-compose.yml
  services:
    magpie:
      environment:
        ENCRYPTION_KEY_FILE: /run/secrets/magpie_key
      secrets:
        - magpie_key
  secrets:
    magpie_key:
      file: ./magpie_key.txt   # chmod 600
  ```

## Looking after the key

- **Keep a copy outside the server**, e.g. in a password manager. If the key is lost, the data cannot be recovered. Nobody can help with that, by design.
- **The key cannot be changed** after the first start. A database created with one key only opens with that key.
- Use a long random key: `openssl rand -hex 32` (64 characters). Shorter than 32 characters is refused.

## If the key is wrong or missing

The app refuses to start and says why:

- `ENCRYPTION_KEY is required` – no key is set (the Docker image always needs one).
- `ENCRYPTION_KEY is too short` – use at least 32 characters.
- `Cannot open the database: ENCRYPTION_KEY is wrong, or the database was created without one.` – the key does not match the one the database was created with.

## Opening the database yourself

Because the database uses the standard SQLCipher 4 format, you can inspect a copy with [DB Browser for SQLite](https://sqlitebrowser.org/):

1. Stop the app or work on a [backup copy](backups.md).
2. Open `app.db`. In the password dialog choose **SQLCipher 4 defaults** and enter the key as the password (choose *Passphrase*, not *Raw key*).

Don't edit a database the app is using.
