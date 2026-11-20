# Development

Magpie is developed with an AI coding assistant ([Claude Code](https://claude.com/claude-code)); commits written that way carry a `Co-Authored-By: Claude …` line. See [How Magpie is made](how-it-is-made.md). Hand-written contributions and reviews are just as welcome.

## Setup

Requires Node.js 22 or later.

```sh
npm install
npm run dev        # API on :3000 (tsx watch) + web app on :5173 (Vite, proxies /api)
```

Open http://localhost:5173. In development, data is stored in `apps/server/data/`. Without `ENCRYPTION_KEY` it is stored unencrypted and a warning is logged; set the key in your shell to work with an encrypted database.

## Commands

```sh
npm test                     # server tests (vitest)
npm run typecheck            # all workspaces
npm run build                # web -> apps/web/dist, server bundle -> apps/server/dist (includes the web build)
npm start -w @notes/server   # run the production bundle locally (needs npm run build first)
```

## Project layout

```
apps/server/          Fastify API, SQLite (Drizzle ORM); migrations in apps/server/drizzle
apps/web/             React + Mantine single-page app
packages/shared/      zod schemas and types shared by server and web
packages/note-types/  note types: definitions (shared), editors (web), hooks (server)
docker/               container entrypoint
docs/                 this documentation
```

Key places on the server:

| Path | What |
|---|---|
| `apps/server/src/app.ts` | Builds the Fastify app: routes, security headers, hourly housekeeping |
| `apps/server/src/config.ts` | All environment variables |
| `apps/server/src/db/` | Schema and database opening (encryption) |
| `apps/server/src/routes/` | HTTP endpoints, one file per area |
| `apps/server/src/services/` | Business logic: access checks, notes, sharing, privacy, trash, … |
| `apps/server/src/files/store.ts` | Stored files (encrypted on disk) |
| `apps/server/src/links/` | Link previews: safe fetching, extraction, per-site handlers in `sites/` |
| `apps/server/src/live/` | Live updates over Server-Sent Events |

## Database

SQLite through [Drizzle ORM](https://orm.drizzle.team/). The SQLite library is `better-sqlite3-multiple-ciphers`, installed under the name `better-sqlite3` (an npm alias in `apps/server/package.json`): the same library with encryption built in, under the name Drizzle's driver loads. With a key, the database uses the SQLCipher 4 format; see [Encryption](encryption.md).

The schema is in `apps/server/src/db/schema.ts`. It starts with a single migration, `apps/server/drizzle/0000_init.sql`. The hand-written full-text search table (FTS5) and its triggers are at its end, since Drizzle doesn't know about virtual tables.

After changing the schema, create a migration:

```sh
npm run db:generate -w @notes/server -- --name <what-changed>
```

Check the generated SQL: drizzle-kit sometimes splits expression indexes like `ifnull("folder_id", '')` wrongly. Migrations run automatically on start-up.

## Tests

Server tests are in `apps/server/test` and run with vitest against an in-memory database: `npm test`. `test/helpers.ts` has `makeApp()` and a `client()` that behaves like a browser (session cookie, CSRF header).

## Docker image

The [Dockerfile](../Dockerfile) builds in stages: install and build, then install only the native modules the bundle leaves out (`better-sqlite3`, `@node-rs/argon2`, `sharp`), then a small runtime image on `node:24-alpine`. The container starts as root only to make `/data` writable, then runs as the `node` user.

## Adding a note type

See [Adding a note type](note-types.md).
