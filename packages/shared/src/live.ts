/**
 * Live refresh: the server pushes small hints over Server-Sent Events (GET /api/events). They
 * never contain note content; clients refetch what changed through the normal API, so all access
 * checks still apply.
 */
export type LiveEvent =
  /** Sent once when the stream opens. */
  | { kind: 'hello' }
  /** Folders, note lists, trash or shares changed. */
  | { kind: 'tree' }
  /** A note's content (or its server data, e.g. a link preview) changed. */
  | { kind: 'note'; id: string; version: number }
  /** My account (preferences, role) or my view settings of a folder changed. */
  | { kind: 'me' };

/** Each browser tab sends a random id, so it is not told about its own changes. */
export const TAB_HEADER = 'x-notes-tab';
