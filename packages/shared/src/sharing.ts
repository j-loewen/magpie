import { z } from 'zod';

export const SHARE_PERMISSIONS = ['view', 'edit'] as const;
export type SharePermission = (typeof SHARE_PERMISSIONS)[number];
/** What the current user may do with an item. */
export type Permission = 'owner' | SharePermission;

export const canEdit = (p: Permission | undefined) => p === 'owner' || p === 'edit';

const ref = { kind: z.enum(['folder', 'note']), id: z.string().min(1).max(64) };

export const shareSchema = z.object({ ...ref, userId: z.string().min(1).max(64), permission: z.enum(SHARE_PERMISSIONS) });
export type ShareInput = z.infer<typeof shareSchema>;

export const unshareSchema = z.object({ ...ref, userId: z.string().min(1).max(64) });
export const shareRefSchema = z.object(ref);

export interface UserRefDto {
  id: string;
  username: string;
  displayName: string;
}

/** One person an item is shared with (owner's view). */
export interface ShareDto {
  user: UserRefDto;
  permission: SharePermission;
  createdAt: string;
}

/** Something another user shared directly with me. */
export interface SharedItemDto {
  kind: 'folder' | 'note';
  id: string;
  /** Folder name or note title. */
  name: string;
  /** Note type (notes only). */
  type?: string;
  owner: UserRefDto;
  permission: SharePermission;
  sharedAt: string;
  /** Server data for previews (notes only), as in NoteSummaryDto. */
  meta?: unknown;
  excerpt?: string;
  /** Note icon and colour (notes only), as in NoteSummaryDto. */
  icon?: string | null;
  color?: string | null;
}
