# Magpie

Self-hosted notes and bookmarks app: Fastify + SQLite (Drizzle) API, React + Mantine SPA, shipped as one Docker container. npm workspaces; packages are named `@notes/*` (the app's old name), the product is Magpie.

Human-facing docs live in `docs/` — [development.md](docs/development.md) and [note-types.md](docs/note-types.md) are the ones that matter for code changes. Read them rather than duplicating them here.

## Commands

```sh
npm install                       # .npmrc sets ignore-scripts; native modules use prebuilt binaries
npm run dev                       # API :3000 (tsx watch) + Vite :5173 (proxies /api)
npm test                          # server tests (vitest, in-memory DB)
npx vitest run test/notes.test.ts # single file — run from apps/server
npm run typecheck                 # all workspaces; run before calling work done
npm run build                     # web + server bundle
npm run db:generate -w @notes/server -- --name <what-changed>
```

CI (`.github/workflows/`): `checks.yml` (typecheck, tests, build on Node 22 and 24) runs on PRs and `main`. Pushes to `main` publish `ghcr.io/j-loewen/magpie:dev` and then prune old dev images (`cleanup-images.yml`); pushing a `vX.Y.Z` tag publishes `:latest` and creates the GitHub release (`release.yml`). Both use `image.yml` (native amd64 + arm64 runners). See "CI and releases" in docs/development.md. The tag is the version — `package.json` versions are unused.

Before finishing a change: `npm run typecheck` and `npm test` must both pass. There are no web tests; for UI changes, run the app and check it.

## Layout

```
apps/server/src/   app.ts (wiring), config.ts (all env vars), routes/ (HTTP, one file per area),
                   services/ (business logic), db/ (schema, open + encryption), links/ (previews),
                   live/ (SSE), files/ (encrypted file store)
apps/server/test/  vitest; helpers.ts has makeApp() and a browser-like client()
apps/web/src/      pages/, components/, api.ts, live.ts, router.tsx (TanStack Router + Query)
packages/shared/   zod schemas and types used by both sides (consumed as TS source, no build)
packages/note-types/  one folder per note type: index.ts (definition), Editor.tsx, optional Card.tsx
```

## Rules that aren't obvious from the code

- **Access control goes through `apps/server/src/services/access.ts`.** Every route uses it. No access is reported as **404, not 403**, so hidden items (other users', private folders) are never revealed. Keep it that way in new routes.
- **CSRF**: mutating requests need the `CSRF_HEADER` from `@notes/shared`. Tests get it via `client()`; new web fetches must go through `apps/web/src/api.ts`.
- **API shapes belong in `packages/shared`** as zod schemas, validated on the server and reused by the web app.
- **Note type `id`s are stored in the database — never rename one.** Content shape changes need a `version` bump plus a `migrations[oldVersion]` entry. Unknown types are shown read-only and never modified.
- **Schema changes need a migration** (`db:generate`). Check the generated SQL: drizzle-kit mangles expression indexes like `ifnull("folder_id", '')`. The FTS5 table and triggers are hand-written at the end of `0000_init.sql`; Drizzle doesn't know about them.
- **`better-sqlite3` is an alias** for `better-sqlite3-multiple-ciphers` (SQLCipher). Don't "fix" the alias. Don't add dependencies that need install scripts or a native build: `.npmrc` disables install scripts, and so does the Dockerfile.
- **New env vars** go in `config.ts`, `.env.example` and `docs/configuration.md`.
- **User-supplied URLs are fetched only through `links/safe-fetch.ts`** (SSRF protection: private/LAN addresses blocked unless `LINK_PREVIEW_ALLOW_LAN`). Plain `fetch`/undici is only for configured endpoints (SSO providers, FlareSolverr).
- **Keep the docs in sync**: user-visible changes update `docs/` (user guide, configuration, etc.) in the same change.
- **TypeScript is strict** with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (use `import type`).
- **Line endings are LF** (`.gitattributes`); the code is built and run on Linux.

## Environment notes

- Dev data lives in `apps/server/data/` (git-ignored). The dev server does **not** read `.env` — that file is for Docker Compose. Without `ENCRYPTION_KEY` in the shell, the dev DB is unencrypted (a warning is logged; that's expected).
- Development happens on Windows. Stopping `npm run dev` can leave the node processes running and holding :3000 / :5173 — check with `netstat -ano` and kill them by PID.
- Commits carry a `Co-Authored-By: Claude …` line; the project documents this in `docs/how-it-is-made.md`.
