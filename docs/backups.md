# Backing up and restoring

Magpie has no built-in backup. Everything is in the `./data` folder on the host, so a backup is a copy of that folder, made with whatever tool you already use.

## Make a backup

Stop the app while copying, so the database is not written to halfway through:

```sh
cd /path/to/magpie
docker compose stop
cp -a data /path/to/backups/magpie-$(date +%F)
docker compose start
```

The copy is [encrypted](encryption.md), so it is safe to keep on another disk, another machine or in cloud storage. **Keep the encryption key separately**: a backup is useless without it.

### Automating it

A nightly cron job on the host, for example:

```sh
# crontab -e
30 3 * * * cd /path/to/magpie && docker compose stop -t 30 && rsync -a --delete data/ /mnt/backup/magpie/ ; docker compose start
```

Tools like restic, Borg or rsnapshot work the same way: stop, copy `data/`, start. Versioned backups (several days back) protect you from deleting something by mistake and only noticing later.

## Restore

1. Stop the app: `docker compose down`
2. Replace the `data` folder with the backup copy (the whole folder, including `app.db-wal` if present).
3. Make sure `.env` has the **same `ENCRYPTION_KEY`** as when the backup was made.
4. Start the app: `docker compose up -d`

If the key does not match, the app refuses to start with "ENCRYPTION_KEY is wrong".

## Exports for single users

Every user can download their own notes as a zip under **Settings → Import & export**. It contains a file the app can import again exactly, plus every note as a readable file (Markdown, text, code) in its folder structure. Exports are **not** encrypted; treat them like any other personal file. See [Import and export](user-guide.md#import-and-export).

## Lost preview images

If `data/files` is lost but the database is not, notes are complete; only link preview images and icons are missing. **Refresh preview** in a link note fetches them again. [Storage clean-up](administration.md#storage) removes the leftover database entries.
