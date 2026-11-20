export interface NoteEditorProps<C> {
  noteId: string;
  value: C;
  onChange: (next: C) => void;
  /** Content cannot be edited: a view-only share, or the note is in view mode (see `viewMode`). */
  readOnly: boolean;
  /**
   * The note is shown in view mode although the user may edit it (they click Edit to change it).
   * A type may still allow light use here, e.g. ticking checklist items. Implies `readOnly`.
   */
  viewMode?: boolean;
  colorScheme: 'light' | 'dark';
  /** Server-provided data for this note (e.g. link preview), refreshed while pending. */
  meta?: unknown;
  /** Ask the server to fetch its data again (link previews). */
  refreshMeta?: () => void;
}

/** What a folder card knows about a note (no content, just the summary). */
export interface NoteCardProps {
  title: string;
  excerpt: string;
  meta?: unknown;
  /** Masonry view: cards take the height they need, so show more (more items, longer text). */
  expanded?: boolean;
}
