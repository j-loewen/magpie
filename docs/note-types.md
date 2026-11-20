# Adding a note type

Each note type lives in its own folder, `packages/note-types/src/<type>/`, and is shared by server and web.

## The definition: `index.ts`

Define the type with `defineNoteType`:

- `id`: stored in the database; never rename it
- `label` and `version`
- a zod `schema` for its content
- `createDefault()`: content of a new note
- `toSearchText()`: plain text for search and card previews
- `migrations`: for when the content shape changes. Bump `version` and add `migrations[oldVersion]`. Old notes are upgraded when read, and saved in the new shape on their next save.
- optionally `toFile()`: the readable file in exports and downloads (JSON otherwise)
- optionally `importExtensions` with `fromFile()`, to import files of that kind

## The editor: `Editor.tsx`

A React component that receives `value`, `onChange`, `readOnly` and `colorScheme`. It is loaded lazily, so heavy editors don't slow down the app.

Optionally add a `CardBody` for folder cards (see the checklist type).

## Registering it

1. Add the type to `packages/note-types/src/index.ts`.
2. Add it to `packages/note-types/src/client.ts` with an icon and colour.

## Server-side behaviour

If the type needs work on the server, such as fetching link metadata, register hooks for it in `apps/server/src/app.ts`. See `apps/server/src/note-hooks.ts`, and `apps/server/src/links/` for an example.

Hooks run after saves. They can add searchable text, and attach a `meta` object that the editor and cards receive.

## Unknown types

A note whose type isn't known to the running version is shown read-only. It is never modified.
