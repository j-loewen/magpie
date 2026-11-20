/** Page information fetched by the server for a link note (NoteDto.meta for type "link"). */
export interface LinkMetaDto {
  /**
   * pending: fetch queued or running · ok: fetched · error: fetch failed (see `error`)
   * · disabled: link previews are turned off on this server
   */
  status: 'pending' | 'ok' | 'error' | 'disabled';
  /** URL the metadata was fetched for. */
  url: string;
  /** URL after redirects. */
  finalUrl?: string;
  title?: string;
  description?: string;
  siteName?: string;
  /** OpenGraph type, e.g. "article", "video.other". */
  ogType?: string;
  contentType?: string;
  /** Preview image served by this app (never hot-linked). */
  imageUrl?: string;
  faviconUrl?: string;
  /** Parsed JSON-LD blocks (@graph flattened). */
  jsonLd?: unknown[];
  error?: string;
  fetchedAt?: string;
}
