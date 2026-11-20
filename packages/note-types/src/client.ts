import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { IconAlignLeft, IconBinaryTree2, IconCode, IconLink, IconListCheck, IconMarkdown, type Icon } from '@tabler/icons-react';
import type { NoteTypeDef } from './define';
import { checklistType } from './checklist';
import { ChecklistCardBody } from './checklist/Card';
import { codeType } from './code';
import { linkType, parseHttpUrl } from './link';
import { hostOf, LinkCardBody, linkMeta } from './link/Card';
import { markdownType } from './markdown';
import { mindmapType } from './mindmap';
import { textType } from './text';
import type { NoteCardProps, NoteEditorProps } from './editor-kit/types';

export type { NoteCardProps, NoteEditorProps } from './editor-kit/types';

/** Browser-side parts of a note type. Editors are lazy-loaded, so heavy editors cost nothing until used. */
export interface NoteTypeClient {
  def: NoteTypeDef<any>;
  icon: Icon;
  /** Mantine colour used for the type's icon. */
  color: string;
  Editor: LazyExoticComponent<ComponentType<NoteEditorProps<any>>>;
  /** Custom body for folder cards (default: text excerpt). Keep it light: it is not lazy-loaded. */
  CardBody?: ComponentType<NoteCardProps>;
  /** Image shown at the top of folder cards. */
  cardImage?: (meta: unknown) => string | undefined;
  /** Title filled into an untitled note once available (e.g. the fetched page title). */
  suggestTitle?: (meta: unknown) => string | undefined;
  /** Shown (not saved) for untitled notes when there is no suggestion, e.g. the link's domain. */
  fallbackTitle?: (meta: unknown) => string | undefined;
  /** Image used as the note's icon until the user picks one (e.g. the link's favicon). */
  defaultIconImage?: (meta: unknown) => string | undefined;
  /** Web page whose title can name a new, still untitled note (link notes: their address). */
  titleLookupUrl?: (content: any) => string | undefined;
  /**
   * Where clicking the note in a list goes instead of opening the note (link notes: the web page,
   * in a new tab). The note itself is then opened from its "…" menu.
   */
  openUrl?: (meta: unknown) => string | undefined;
  /** New notes focus the title field first (default true). */
  focusTitleOnCreate?: boolean;
  /**
   * Size of the dialog the note opens in (default `md`). `sm` and `md` grow with the content;
   * `lg` editors fill a large, fixed-height dialog (they scroll or pan inside it).
   */
  dialogSize?: NoteDialogSize;
}

export type NoteDialogSize = 'sm' | 'md' | 'lg';

export const clientNoteTypes: NoteTypeClient[] = [
  { def: markdownType, icon: IconMarkdown, color: 'indigo', Editor: lazy(() => import('./markdown/Editor')), dialogSize: 'lg' },
  {
    def: linkType,
    icon: IconLink,
    color: 'blue',
    dialogSize: 'sm',
    Editor: lazy(() => import('./link/Editor')),
    CardBody: LinkCardBody,
    cardImage: (meta) => linkMeta(meta)?.imageUrl,
    suggestTitle: (meta) => {
      const m = linkMeta(meta);
      return m?.status === 'ok' ? m.title : undefined;
    },
    fallbackTitle: (meta) => hostOf(linkMeta(meta)?.url) || undefined,
    defaultIconImage: (meta) => linkMeta(meta)?.faviconUrl,
    titleLookupUrl: (content: { url: string }) => parseHttpUrl(content.url)?.toString(),
    openUrl: (meta) => {
      const m = linkMeta(meta);
      return parseHttpUrl(m?.finalUrl || m?.url || '')?.toString();
    },
    focusTitleOnCreate: false,
  },
  { def: checklistType, icon: IconListCheck, color: 'green', Editor: lazy(() => import('./checklist/Editor')), CardBody: ChecklistCardBody },
  { def: mindmapType, icon: IconBinaryTree2, color: 'grape', Editor: lazy(() => import('./mindmap/Editor')), dialogSize: 'lg' },
  // Large dialog: the toolbar stays on top while the text scrolls below it.
  { def: textType, icon: IconAlignLeft, color: 'gray', Editor: lazy(() => import('./text/Editor')), dialogSize: 'lg' },
  { def: codeType, icon: IconCode, color: 'teal', Editor: lazy(() => import('./code/Editor')), dialogSize: 'lg' },
];

const byId = new Map(clientNoteTypes.map((t) => [t.def.id, t]));
export const getClientNoteType = (id: string) => byId.get(id);

/** Title to display: the note's own title, else a type-specific suggestion, else "Untitled". */
export function displayTitle(note: { type: string; title: string; meta?: unknown }): string {
  const type = byId.get(note.type);
  return (
    note.title.trim() || type?.suggestTitle?.(note.meta)?.trim() || type?.fallbackTitle?.(note.meta)?.trim() || 'Untitled'
  );
}
