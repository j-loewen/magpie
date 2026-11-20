import type { SearchResultDto } from '@notes/shared';
import type { Db } from '../db';
import { folderPermission, HIDDEN_FOLDERS_SQL, SHARED_TREE_SQL, viewerParams, type Viewer } from './access';
import { loadMetaFor } from './notes';

/**
 * Turns user input into a safe FTS5 query: every word becomes a quoted prefix term, and all terms
 * must match. FTS syntax characters typed by the user are never interpreted.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12);
  if (!terms?.length) return null;
  return terms.map((t) => `"${t}"*`).join(' ');
}

export function searchNotes(db: Db, viewer: Viewer, q: string, limit = 50): SearchResultDto[] {
  const match = toFtsQuery(q);
  if (!match) return [];
  const rows = db.$client
    .prepare(
      `WITH RECURSIVE ${HIDDEN_FOLDERS_SQL}, ${SHARED_TREE_SQL}
       SELECT n.id, n.folder_id AS folderId, n.owner_id AS ownerId, u.display_name AS ownerName,
              n.type, n.title, n.icon, n.color, n.updated_at AS updatedAt,
              snippet(notes_fts, 2, char(1), char(2), '…', 16) AS snippet
         FROM notes_fts JOIN notes n ON n.id = notes_fts.note_id JOIN users u ON u.id = n.owner_id
        WHERE notes_fts MATCH @match AND n.deleted_at IS NULL
          AND (n.owner_id = @viewerId
               OR n.folder_id IN (SELECT id FROM shared_tree)
               OR n.id IN (SELECT note_id FROM note_shares WHERE user_id = @viewerId))
          AND (n.folder_id IS NULL OR n.folder_id NOT IN (SELECT id FROM hidden))
        ORDER BY bm25(notes_fts, 0.0, 8.0, 1.0)
        LIMIT @limit`,
    )
    .all({ match, limit, ...viewerParams(viewer) }) as (Omit<SearchResultDto, 'updatedAt' | 'ownerName'> & {
    updatedAt: number;
    ownerId: string;
    ownerName: string;
  })[];
  const meta = loadMetaFor(db, rows);
  return rows.map(({ ownerId, ownerName, ...r }) => {
    const mine = ownerId === viewer.id;
    // Notes shared on their own: do not reveal the owner's folder.
    const folderVisible = mine || (r.folderId !== null && folderPermission(db, viewer, { id: r.folderId, ownerId }) !== null);
    return {
      ...r,
      folderId: folderVisible ? r.folderId : null,
      ...(!mine && { ownerName }),
      ...(meta.has(r.id) && { meta: meta.get(r.id) }),
      updatedAt: new Date(r.updatedAt).toISOString(),
    };
  });
}
