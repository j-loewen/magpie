# Administration

## Roles

- The **first account** registered becomes **admin**. Every later account is a **user**.
- Admins manage accounts only. **They cannot see anyone's notes** unless those notes are shared with them.
- The last remaining admin cannot be demoted or deleted.

## User accounts

Admins open **Users** in the user menu (top right). There they can:

- create accounts (needed when `ALLOW_REGISTRATION=false`)
- promote users to admin, or demote them
- reset a password (that user is signed out everywhere)
- delete an account

Deleting a user deletes their folders and notes, and anything they shared is gone for the people they shared it with. Edits they made in other people's notes are kept.

Everyone manages their own profile, password, theme and [sign-in methods](sign-in.md) under **Settings**.

## Storage

**Settings → Storage** (admins only) shows the space used on the server: stored files (link preview images and icons) and the database.

**Clean up now** removes everything that is no longer used:

- files of notes that were deleted permanently
- leftover files nothing refers to
- file entries whose file is missing
- expired logins

It also compacts the database and gives the freed space back to the disk. Notes in anyone's trash are not touched.

All of this except compacting also runs by itself at start-up and every hour, together with emptying trash older than `TRASH_DAYS`. When a note is deleted permanently (trash emptied, removed after `TRASH_DAYS`, or its owner's account deleted), its files are removed right away.

## Logs

```sh
docker compose logs -f magpie
```

Set `LOG_LEVEL=debug` in `.env` for more detail (for example, to see why a link preview failed).
