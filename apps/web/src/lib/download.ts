import { getNoteType, noteToFile } from '@notes/note-types';
import { displayTitle } from '@notes/note-types/client';
import { saveBlob } from '../api';

/** File-system-safe name (mirrors the server's export naming). */
export function safeFileName(name: string, fallback = 'Untitled') {
  const cleaned = name
    .replace(/[\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|[. ]+$/g, '')
    .slice(0, 100)
    .trim();
  return cleaned || fallback;
}

/** Save one note as a readable file (Markdown, text, code…), in the browser. Pass the editor's current content. */
export function downloadNote(note: { type: string; title: string; content: unknown; meta?: unknown }) {
  const file = noteToFile(getNoteType(note.type), note.content, note.title);
  const name = safeFileName(displayTitle(note));
  const type = file.ext === 'json' ? 'application/json' : 'text/plain';
  saveBlob(new Blob([file.text], { type: `${type};charset=utf-8` }), `${name}.${file.ext}`);
}
