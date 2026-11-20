import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  PruneResultDto,
  StorageStatusDto,
  ImportResultDto,
  CreateFolderInput,
  CreateNoteInput,
  FolderDto,
  NoteDto,
  NoteSort,
  NoteSummaryDto,
  PatchNoteInput,
  SearchResultDto,
  ShareDto,
  SharedItemDto,
  SharePermission,
  TrashDto,
  UpdateFolderInput,
  UpdateFolderViewInput,
  FolderViewDto,
  UserRefDto,
} from '@notes/shared';
import { DEFAULT_FOLDER_VIEW } from '@notes/shared';
import { api, downloadFile, uploadFile } from './api';

/** Server data still being produced (e.g. a link preview being fetched): poll until it settles. */
const isPending = (meta: unknown) => (meta as { status?: string } | undefined)?.status === 'pending';
const POLL_MS = 1500;

export const keys = {
  folders: ['folders'] as const,
  notes: (folderId: string | null, sort: NoteSort) => ['notes', folderId ?? 'root', sort] as const,
  folderView: (folderId: string | null) => ['folder-view', folderId ?? 'root'] as const,
  note: (id: string) => ['note', id] as const,
  trash: ['trash'] as const,
  search: (q: string) => ['search', q] as const,
};

/** Folder/note lists, counts, trash and search all depend on the tree; refresh them together. */
export function invalidateTree(qc: QueryClient) {
  for (const key of [['folders'], ['notes'], ['trash'], ['search'], ['shared']]) void qc.invalidateQueries({ queryKey: key });
}

// ---- Folders --------------------------------------------------------------------

export function useFolders() {
  return useQuery({ queryKey: keys.folders, queryFn: () => api<FolderDto[]>('/api/folders') });
}

export interface FolderIndex {
  byId: Map<string, FolderDto>;
  children: (parentId: string | null) => FolderDto[];
  /** Ancestors from the top down, ending with the folder itself. */
  path: (id: string | null) => FolderDto[];
  /** True if `id` is `ancestorId` or lies below it. */
  isWithin: (id: string, ancestorId: string) => boolean;
}

export function useFolderIndex(): FolderIndex & { isPending: boolean } {
  const { data, isPending } = useFolders();
  return useMemo(() => {
    const list = data ?? [];
    const byId = new Map(list.map((f) => [f.id, f]));
    const kids = new Map<string | null, FolderDto[]>();
    for (const f of list) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f]);
    const path = (id: string | null) => {
      const out: FolderDto[] = [];
      for (let f = id ? byId.get(id) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) out.unshift(f);
      return out;
    };
    return {
      isPending,
      byId,
      children: (parentId) => kids.get(parentId) ?? [],
      path,
      isWithin: (id, ancestorId) => path(id).some((f) => f.id === ancestorId),
    };
  }, [data, isPending]);
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFolderInput) => api<FolderDto>('/api/folders', 'POST', input),
    onSuccess: () => invalidateTree(qc),
  });
}

export function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateFolderInput & { id: string }) => api<FolderDto>(`/api/folders/${id}`, 'PATCH', input),
    onSuccess: () => invalidateTree(qc),
  });
}

export function useTrashFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/folders/${id}`, 'DELETE'),
    onSuccess: () => invalidateTree(qc),
  });
}

// ---- Notes ----------------------------------------------------------------------

/** My sort, layout and card size for a folder (null = Home). */
export function useFolderView(folderId: string | null) {
  return useQuery({
    queryKey: keys.folderView(folderId),
    queryFn: () => api<FolderViewDto>(`/api/folder-view${folderId ? `?${new URLSearchParams({ folderId })}` : ''}`),
    // Only I change it; other devices are told over the live stream.
    staleTime: Infinity,
  });
}

export function useUpdateFolderView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateFolderViewInput) => api<FolderViewDto>('/api/folder-view', 'PUT', input),
    // Shown at once. The answer is not applied: with quick changes (e.g. the size slider) answers
    // can arrive out of order, and the optimistic value already is the latest one.
    onMutate: ({ folderId, ...patch }) => {
      qc.setQueryData<FolderViewDto>(keys.folderView(folderId), (old) => ({ ...DEFAULT_FOLDER_VIEW, ...old, ...patch }));
    },
    onError: (_err, { folderId }) => void qc.invalidateQueries({ queryKey: keys.folderView(folderId) }),
  });
}

export function useNotes(folderId: string | null, sort: NoteSort, enabled = true) {
  const params = new URLSearchParams({ sort, ...(folderId && { folderId }) });
  return useQuery({
    enabled,
    queryKey: keys.notes(folderId, sort),
    queryFn: () => api<NoteSummaryDto[]>(`/api/notes?${params}`),
    refetchInterval: (q) => (q.state.data?.some((n) => isPending(n.meta)) ? POLL_MS : false),
  });
}

export function useNote(id: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: keys.note(id),
    queryFn: () => api<NoteDto>(`/api/notes/${id}`),
    retry: false,
    refetchInterval: (q) => (isPending(q.state.data?.meta) ? POLL_MS : false),
  });
}

/** Ask the server to fetch a note's server data (link preview) again. */
export function useRefreshMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/api/notes/${id}/refresh-meta`, 'POST'),
    onSuccess: (meta, id) => {
      qc.setQueryData<NoteDto>(keys.note(id), (old) => (old ? { ...old, meta } : old));
      void qc.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNoteInput) => api<NoteDto>('/api/notes', 'POST', input),
    onSuccess: (note) => {
      qc.setQueryData(keys.note(note.id), note);
      invalidateTree(qc);
    },
  });
}

export function usePatchNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: PatchNoteInput & { id: string }) => api<NoteDto>(`/api/notes/${id}`, 'PATCH', input),
    // Pin, icon and colour show at once; the server's answer (or a refetch on error) settles them.
    onMutate: ({ id, folderId: _folderId, ...shown }) => {
      qc.setQueryData<NoteDto>(keys.note(id), (old) => (old ? { ...old, ...shown } : old));
    },
    onSuccess: (note) => {
      // Only metadata changed: keep any open editor's content, update the metadata.
      const { folderId, pinned, icon, color } = note;
      qc.setQueryData<NoteDto>(keys.note(note.id), (old) => (old ? { ...old, folderId, pinned, icon, color } : note));
      invalidateTree(qc);
    },
    onError: (_err, { id }) => void qc.invalidateQueries({ queryKey: keys.note(id) }),
  });
}

export function useTrashNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/notes/${id}`, 'DELETE'),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: keys.note(id) });
      invalidateTree(qc);
    },
  });
}

// ---- Trash & search ----------------------------------------------------------------

export function useTrash() {
  return useQuery({ queryKey: keys.trash, queryFn: () => api<TrashDto>('/api/trash') });
}

export function useTrashActions() {
  const qc = useQueryClient();
  const done = () => invalidateTree(qc);
  return {
    restore: useMutation({
      mutationFn: (item: { kind: 'folder' | 'note'; id: string }) => api<void>('/api/trash/restore', 'POST', item),
      onSuccess: done,
    }),
    purge: useMutation({
      mutationFn: (item: { kind: 'folder' | 'note'; id: string }) => api<void>(`/api/trash/${item.kind}/${item.id}`, 'DELETE'),
      onSuccess: done,
    }),
    empty: useMutation({ mutationFn: () => api<void>('/api/trash', 'DELETE'), onSuccess: done }),
  };
}

export function useSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => api<SearchResultDto[]>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
    placeholderData: (prev) => prev,
  });
}

// ---- Sharing ----------------------------------------------------------------------

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => api<UserRefDto[]>('/api/users'), staleTime: 60_000 });
}

export function useSharedWithMe() {
  return useQuery({ queryKey: ['shared'], queryFn: () => api<SharedItemDto[]>('/api/shared') });
}

export function useShares(kind: 'folder' | 'note', id: string | null) {
  return useQuery({
    queryKey: ['shares', kind, id],
    queryFn: () => api<ShareDto[]>(`/api/shares?kind=${kind}&id=${id}`),
    enabled: id !== null,
  });
}

export function useShareActions(kind: 'folder' | 'note', id: string) {
  const qc = useQueryClient();
  const done = (shares: ShareDto[]) => {
    qc.setQueryData(['shares', kind, id], shares);
    // Share counts / icons in listings.
    void qc.invalidateQueries({ queryKey: kind === 'folder' ? ['folders'] : ['notes'] });
    if (kind === 'note') void qc.invalidateQueries({ queryKey: ['note', id] });
  };
  return {
    share: useMutation({
      mutationFn: (input: { userId: string; permission: SharePermission }) => api<ShareDto[]>('/api/shares', 'PUT', { kind, id, ...input }),
      onSuccess: done,
    }),
    unshare: useMutation({
      mutationFn: (userId: string) => api<ShareDto[]>('/api/shares', 'DELETE', { kind, id, userId }),
      onSuccess: done,
    }),
  };
}

export function useLeaveShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: { kind: 'folder' | 'note'; id: string }) => api<void>('/api/shared', 'DELETE', item),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shared'] });
      invalidateTree(qc);
    },
  });
}

// ---- Import / export -----------------------------------------------------

export function useImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, folderId, previews }: { file: File; folderId: string | null; previews: boolean }) => {
      const params = new URLSearchParams({ name: file.name, previews: String(previews) });
      if (folderId) params.set('folderId', folderId);
      return uploadFile<ImportResultDto>(`/api/import?${params}`, file);
    },
    onSettled: () => invalidateTree(qc),
  });
}

/** Download everything I own, or one folder, as a zip. */
export const exportNotes = (folderId: string | null) =>
  downloadFile(folderId ? `/api/export?folderId=${encodeURIComponent(folderId)}` : '/api/export', 'magpie-export.zip');

// ---- Storage maintenance (admin) -----------------------------------------------------

const storageKey = ['admin', 'storage'] as const;

export function useStorage(enabled: boolean) {
  return useQuery({ queryKey: storageKey, queryFn: () => api<StorageStatusDto>('/api/admin/storage'), enabled });
}

export function usePruneStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<PruneResultDto>('/api/admin/storage/prune', 'POST'),
    onSuccess: (result) => qc.setQueryData(storageKey, result.status),
  });
}
