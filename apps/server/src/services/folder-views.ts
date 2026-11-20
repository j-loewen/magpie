import { and, eq, isNull } from 'drizzle-orm';
import { DEFAULT_FOLDER_VIEW, type FolderViewDto, type UpdateFolderViewInput } from '@notes/shared';
import type { Db } from '../db';
import { folderViews } from '../db/schema';
import { getFolderFor, type Viewer } from './access';

const whereFor = (viewer: Viewer, folderId: string | null) =>
  and(eq(folderViews.userId, viewer.id), folderId === null ? isNull(folderViews.folderId) : eq(folderViews.folderId, folderId));

/** My view settings for a folder (null = Home); defaults until I change them. Needs read access. */
export function getFolderView(db: Db, viewer: Viewer, folderId: string | null): FolderViewDto {
  if (folderId) getFolderFor(db, viewer, folderId, 'read');
  const row = db.select().from(folderViews).where(whereFor(viewer, folderId)).get();
  return row ? { sort: row.sort, view: row.view, cardSize: row.cardSize, noteOrder: row.noteOrder } : { ...DEFAULT_FOLDER_VIEW };
}

/** Changes only my own settings: viewing a folder is enough, also when it is shared view-only. */
export function updateFolderView(db: Db, viewer: Viewer, { folderId, ...patch }: UpdateFolderViewInput): FolderViewDto {
  return db.transaction(() => {
    const next = { ...getFolderView(db, viewer, folderId), ...patch };
    const exists = db.select({ userId: folderViews.userId }).from(folderViews).where(whereFor(viewer, folderId)).get();
    if (exists) db.update(folderViews).set({ ...next, updatedAt: new Date() }).where(whereFor(viewer, folderId)).run();
    else db.insert(folderViews).values({ userId: viewer.id, folderId, ...next }).run();
    return next;
  });
}
