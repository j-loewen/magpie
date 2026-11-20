import type { NoteTypeDef } from './define';
import { checklistType } from './checklist';
import { codeType } from './code';
import { linkType } from './link';
import { markdownType } from './markdown';
import { mindmapType } from './mindmap';
import { textType } from './text';

export * from './define';
export type { RichMark, RichNode, TextContent } from './text';
export type { MarkdownContent } from './markdown';
export type { CodeContent } from './code';
export type { LinkContent } from './link';
export type { ChecklistContent, ChecklistItem } from './checklist';
export type { MindmapContent, MindNode } from './mindmap';
export { parseHttpUrl } from './link';
export { cleanUrl } from './link/clean-url';
export { articleFacts, bookFacts, durationMinutes, encyclopediaFacts, formatArticleFacts, formatBookFacts, formatEncyclopediaFacts, formatFacts, formatMediaFacts, formatMinutes, formatMusicFacts, formatPodcastFacts, formatQuestionFacts, formatRecipeFacts, formatSoftwareFacts, formatVideoFacts, mediaFacts, musicFacts, pageFactsText, podcastFacts, productFacts, questionFacts, recipeFacts, softwareFacts, videoFacts, type ArticleFacts, type BookFacts, type EncyclopediaFacts, type MediaFacts, type MusicFacts, type PodcastFacts, type ProductFacts, type QuestionFacts, type RecipeFacts, type SoftwareFacts, type VideoFacts } from './link/product';

/** All note types, in the order they are offered in "New note" menus. */
export const noteTypeList: NoteTypeDef<any>[] = [markdownType, linkType, checklistType, mindmapType, textType, codeType];

const byId = new Map(noteTypeList.map((t) => [t.id, t]));
export const getNoteType = (id: string): NoteTypeDef<any> | undefined => byId.get(id);

const byExtension = new Map<string, NoteTypeDef<any>>();
for (const t of noteTypeList) for (const ext of t.importExtensions ?? []) if (!byExtension.has(ext)) byExtension.set(ext, t);
/** The note type that imports files with this extension (lowercase, no dot). */
export const noteTypeForExtension = (ext: string): NoteTypeDef<any> | undefined => byExtension.get(ext.toLowerCase());
