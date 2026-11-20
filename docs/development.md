# Development

Magpie is developed with an AI coding assistant ([Claude Code](https://claude.com/claude-code)); commits written that way carry a `Co-Authored-By: Claude …` line. See [How Magpie is made](how-it-is-made.md). Hand-written contributions and reviews are just as welcome.

## Setup

Requires Node.js 22 or later. No Python or C++ build tools are needed: the native modules ship prebuilt binaries, and `.npmrc` turns off dependency install scripts so npm doesn't try to compile `better-sqlite3` from source.

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

## CI and releases

GitHub Actions in [`.github/workflows`](../.github/workflows):

| Workflow | When | What |
|---|---|---|
| `ci.yml` | Pull requests | Checks, and a Docker build (not pushed) |
| `ci.yml` | Pushes to `main` | Checks, then publishes `ghcr.io/j-loewen/magpie:dev` and `:sha-<commit>`, then cleans up old dev images |
| `release.yml` | Version tags (`v*.*.*`) | Checks, then publishes `:<version>`, `:<major>.<minor>` and `:latest`, then creates the GitHub release with notes generated from the commits since the previous one |
| `cleanup-images.yml` | After each dev build, or by hand | Keeps the 10 newest `sha-*` images plus `dev`; deletes older ones and leftovers of failed builds. Never touches release images. Started by hand from the Actions tab, it is a dry run by default |

The reusable parts: `checks.yml` (typecheck, tests and build on Node 22 and 24) and `image.yml` (builds amd64 and arm64 natively on separate runners, then combines them into one image).

**One-time setup** after the first image is published, on the package page (repository sidebar → **Packages** → **magpie** → **Package settings**):

- **Change visibility** to **Public**, so the image can be pulled without signing in.
- Under **Manage Actions access**, give the `magpie` repository the **Admin** role. The cleanup job needs it to delete old images.

To release, tag `main` and push the tag:

```sh
git tag -a v0.2.0 -m "Magpie 0.2.0"
git push origin v0.2.0
```

The tag is the version; the `version` fields in the `package.json` files are not used. Tags with a suffix (`v0.2.0-beta.1`) become pre-releases and don't move the `latest` image tag. Edit the generated notes on GitHub afterwards if they need context.

## Adding a note type

See [Adding a note type](note-types.md).
