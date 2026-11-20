import { z } from 'zod';

// ---- Import / export -------------------------------------------------------------------

export const importQuerySchema = z.object({
  /** File name, used to detect the format and to name the folder an archive is imported into. */
  name: z.string().trim().min(1).max(255),
  /** Import into this folder; omitted = top level. */
  folderId: z.string().min(1).max(64).optional(),
  /** Fetch page previews for imported links. */
  previews: z.enum(['true', 'false']).default('true'),
});
export type ImportQuery = z.infer<typeof importQuerySchema>;

export interface ImportResultDto {
  /** Folder created for an archive or bookmarks file (null when files went straight into the target). */
  folderId: string | null;
  folders: number;
  notes: number;
  /** First skipped files with the reason (see skippedCount for the total). */
  skipped: { name: string; reason: string }[];
  skippedCount: number;
}

/** Largest upload accepted by the import endpoint. */
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;

// ---- Storage maintenance (admin) -------------------------------------------------------

export interface StorageStatusDto {
  /** Stored files (link preview images and icons). */
  files: { count: number; bytes: number };
  databaseBytes: number;
}

export interface PruneResultDto {
  /** Folders of notes that were deleted permanently. */
  noteFolders: number;
  /** Files on disk that nothing referred to. */
  strayFiles: number;
  /** Database entries whose file was missing. */
  missingFiles: number;
  emptyFolders: number;
  /** Expired login sessions removed. */
  sessions: number;
  bytesFreed: number;
  /** Database size before and after compacting it. */
  databaseBytesBefore: number;
  databaseBytesAfter: number;
  status: StorageStatusDto;
}
