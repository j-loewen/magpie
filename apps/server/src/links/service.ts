import { eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { LinkMetaDto } from '@notes/shared';
import { parseHttpUrl, type LinkContent } from '@notes/note-types';
import type { AppConfig } from '../config';
import type { Db } from '../db';
import { linkMeta, notes, type LinkMetaRow, type NoteRow } from '../db/schema';
import type { FileStore } from '../files/store';
import type { NoteTypeHooks } from '../note-hooks';
import { refreshSearchText } from '../services/notes';
import { decodeHtml, extractMetadata, type PageMetadata } from './extract';
import { makeIcon, makeThumbnail } from './images';
import { FetchError, safeFetch, type SafeFetchResult } from './safe-fetch';
import { FlareSolverr, looksBlocked } from './flaresolverr';
import {
  githubApiUrl,
  needsBrowser,
  redditOembedUrl,
  redditPageFromOembed,
  redditPostUrl,
  stackExchangeApiUrl,
  stackExchangePage,
  stackExchangeQuestion,
  withGitHubApi,
} from './sites';

const CONCURRENCY = 2;
const HTML_MAX = 2 * 1024 * 1024;
const IMAGE_MAX = 8 * 1024 * 1024;
const ICON_MAX = 256 * 1024;
/** How long and how many fetched pages are kept for reuse (see fetchPageCached). */
const RECENT_MS = 2 * 60 * 1000;
const RECENT_MAX = 10;

export const fileUrl = (id: string | null) => (id ? `/api/files/${id}` : undefined);

export function toLinkMetaDto(row: LinkMetaRow): LinkMetaDto {
  return {
    status: row.status,
    url: row.url,
    finalUrl: row.finalUrl ?? undefined,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    siteName: row.siteName ?? undefined,
    ogType: row.ogType ?? undefined,
    contentType: row.contentType ?? undefined,
    imageUrl: fileUrl(row.imageFileId),
    faviconUrl: fileUrl(row.faviconFileId),
    jsonLd: row.jsonLd ?? undefined,
    error: row.error ?? undefined,
    fetchedAt: row.fetchedAt?.toISOString(),
  };
}

/**
 * Fetches page metadata, preview image and favicon for link notes in the background.
 * Results are written to link_meta only if the note still points at the same URL.
 */
export class LinkPreviews {
  private queue: string[] = [];
  private queued = new Set<string>();
  private running = 0;
  private closed = false;
  private idleWaiters: (() => void)[] = [];
  /** Called when a preview finished (successfully or not). */
  onUpdate: (noteId: string) => void = () => {};
  private readonly flare: FlareSolverr | null;

  constructor(
    private readonly db: Db,
    private readonly store: FileStore,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {
    this.flare = config.flaresolverrUrl ? new FlareSolverr(config.flaresolverrUrl) : null;
  }

  /**
   * The page itself: fetched directly, and through FlareSolverr (if configured) when the site's
   * bot protection refused the direct request. Reddit posts come from Reddit's oEmbed endpoint,
   * Stack Overflow (and other Stack Exchange) questions from the Stack Exchange API.
   */
  private async fetchPage(url: string): Promise<SafeFetchResult> {
    const question = stackExchangeQuestion(url);
    if (question) {
      const fromApi = await this.fromApi(stackExchangeApiUrl(question), question.url, (json) => stackExchangePage(json, question));
      if (fromApi) return fromApi;
    }
    const post = redditPostUrl(url);
    if (post) {
      const fromReddit = await this.fromReddit(post);
      if (fromReddit) return fromReddit;
    }
    const page = await this.fetchDirect(url);
    // Share links (reddit.com/r/…/s/…) redirect to the post.
    const redirectedPost = !post && redditPostUrl(page.finalUrl);
    return (redirectedPost && (await this.fromReddit(redirectedPost))) || page;
  }

  /** A Reddit post as a small page built from its oEmbed description; undefined if unavailable. */
  private fromReddit(postUrl: string): Promise<SafeFetchResult | undefined> {
    return this.fromApi(redditOembedUrl(postUrl), postUrl, (json) => redditPageFromOembed(json, postUrl));
  }

  /**
   * A page built (by `toPage`) from a site's JSON API answer, standing for `pageUrl`; undefined
   * if the API is unavailable or does not know the item (then the page itself is fetched).
   */
  private async fromApi(apiUrl: string, pageUrl: string, toPage: (json: unknown) => string | undefined): Promise<SafeFetchResult | undefined> {
    try {
      const res = await safeFetch(apiUrl, {
        allowPrivate: this.config.linkPreviewAllowLan,
        maxBytes: 512 * 1024,
        accept: 'application/json',
      });
      if (res.status !== 200) {
        this.log.info({ url: apiUrl, status: res.status }, 'API lookup for link preview skipped');
        return undefined;
      }
      const html = toPage(JSON.parse(res.body.toString('utf8')));
      if (!html) return undefined;
      return { finalUrl: pageUrl, status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(html, 'utf8'), truncated: false };
    } catch (err) {
      this.log.warn({ err, url: apiUrl }, 'API lookup for link preview failed');
      return undefined;
    }
  }

  /**
   * A GitHub repository's language and last push, from GitHub's API. Without a token the API
   * allows 60 requests an hour per server; when it refuses, the facts go without them.
   */
  private async fromGitHubApi(apiUrl: string, md: PageMetadata): Promise<PageMetadata> {
    try {
      const res = await safeFetch(apiUrl, {
        allowPrivate: this.config.linkPreviewAllowLan,
        maxBytes: 256 * 1024,
        accept: 'application/vnd.github+json',
      });
      if (res.status !== 200) {
        this.log.info({ url: apiUrl, status: res.status }, 'GitHub API lookup skipped');
        return md;
      }
      return withGitHubApi(md, JSON.parse(res.body.toString('utf8')));
    } catch (err) {
      this.log.warn({ err, url: apiUrl }, 'GitHub API lookup failed');
      return md;
    }
  }

  private async fetchDirect(url: string): Promise<SafeFetchResult> {
    const allowPrivate = this.config.linkPreviewAllowLan;
    let page: SafeFetchResult | undefined;
    let error: unknown;
    try {
      page = await safeFetch(url, { allowPrivate, maxBytes: HTML_MAX, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' });
    } catch (err) {
      error = err;
    }
    const refused = page
      ? looksBlocked(page.status, page.contentType.includes('html') ? page.body.toString('utf8', 0, 50_000) : undefined)
      : error instanceof FetchError && (error.refused || error.message === 'The site took too long to respond');
    if (refused) {
      const solved = await this.viaBrowser(url, 'refused');
      if (solved) return solved;
    }
    if (page) return page;
    throw error;
  }

  /** The page as FlareSolverr's browser sees it; undefined if not configured or it failed. */
  private async viaBrowser(url: string, reason: 'refused' | 'client-rendered'): Promise<SafeFetchResult | undefined> {
    if (!this.flare) return undefined;
    try {
      const solved = await this.flare.fetch(url, { allowPrivate: this.config.linkPreviewAllowLan, maxBytes: HTML_MAX });
      this.log.info({ url, status: solved.status, reason }, 'link preview fetched through FlareSolverr');
      if (solved.status < 400 && !looksBlocked(solved.status, solved.body.toString('utf8', 0, 50_000))) return solved;
    } catch (err) {
      this.log.warn({ err, url, reason }, 'FlareSolverr fallback failed');
    }
    return undefined;
  }

  /**
   * Shop pages that build their product data with JavaScript (e.g. AliExpress) are loaded again
   * in FlareSolverr's browser, which sees price and rating. Otherwise the page is kept as is.
   */
  private async renderIfNeeded(url: string, page: SafeFetchResult): Promise<SafeFetchResult> {
    if (!this.flare || page.status >= 400 || !page.contentType.includes('html')) return page;
    if (!needsBrowser(decodeHtml(page.body, page.contentType))) return page;
    return (await this.viaBrowser(url, 'client-rendered')) ?? page;
  }

  /**
   * Pages fetched in the last minutes. A title lookup for a new link is usually followed by the
   * full preview of the same page as soon as the note is created; that one reuses the page.
   */
  private recent = new Map<string, { at: number; page: SafeFetchResult; rendered: boolean }>();

  /**
   * `render`: also load client-rendered pages in the browser (slow; the preview needs it, a title
   * lookup does not). A page kept from a title lookup is rendered when the preview asks for it.
   */
  private async fetchPageCached(url: string, { render = true } = {}): Promise<SafeFetchResult> {
    const now = Date.now();
    for (const [key, hit] of this.recent) if (now - hit.at > RECENT_MS) this.recent.delete(key);
    let hit = this.recent.get(url);
    if (!hit) {
      hit = { at: now, page: await this.fetchPage(url), rendered: false };
      this.recent.set(url, hit);
      // Keep memory bounded (pages are up to HTML_MAX each); Maps iterate oldest first.
      while (this.recent.size > RECENT_MAX) this.recent.delete(this.recent.keys().next().value!);
    }
    if (render && !hit.rendered) {
      hit.rendered = true;
      hit.page = await this.renderIfNeeded(url, hit.page);
    }
    return hit.page;
  }

  /** Drop a kept page, so the next fetch asks the site again (the "Refresh" button). */
  forget(url: string) {
    this.recent.delete(url);
  }

  /** Title of the page, to name a new link note before it is saved. Undefined if unavailable. */
  async lookupTitle(url: string): Promise<string | undefined> {
    if (!this.config.linkPreviews) return undefined;
    try {
      const page = await this.fetchPageCached(url, { render: false });
      if (page.status >= 400 || !page.contentType.includes('html')) return undefined;
      if (looksBlocked(page.status, page.body.toString('utf8', 0, 50_000))) return undefined;
      return extractMetadata(decodeHtml(page.body, page.contentType), page.finalUrl).title;
    } catch (err) {
      if (!(err instanceof FetchError)) this.log.warn({ err, url }, 'link title lookup failed');
      return undefined;
    }
  }

  hooks(): NoteTypeHooks {
    return {
      afterSave: (note) => this.onSave(note),
      extraSearchText: (id) => this.searchText(id),
      loadMeta: (ids) => this.metaFor(ids),
    };
  }

  /** Re-queue fetches interrupted by a restart. */
  resumePending() {
    for (const row of this.db.select().from(linkMeta).where(eq(linkMeta.status, 'pending')).all()) this.enqueue(row.noteId);
  }

  close() {
    this.closed = true;
    this.queue = [];
  }

  /** Resolves when no fetch is queued or running (used by tests). */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private row(noteId: string) {
    return this.db.select().from(linkMeta).where(eq(linkMeta.noteId, noteId)).get();
  }

  private onSave(note: NoteRow) {
    const url = parseHttpUrl((note.content as LinkContent).url)?.toString();
    const row = this.row(note.id);
    if (!url) {
      if (row) this.clear(note.id, row);
      return;
    }
    if (row?.url !== url) this.refresh(note.id, url);
  }

  /** Queue a (re)fetch. Data for the same URL stays visible while pending; a new URL starts empty. */
  refresh(noteId: string, url: string): LinkMetaDto | undefined {
    if (!this.config.linkPreviews) return undefined;
    const row = this.row(noteId);
    if (row && row.url === url) {
      this.db.update(linkMeta).set({ status: 'pending', error: null }).where(eq(linkMeta.noteId, noteId)).run();
    } else {
      if (row) this.clear(noteId, row);
      this.db.insert(linkMeta).values({ noteId, url, status: 'pending' }).run();
    }
    this.enqueue(noteId);
    return toLinkMetaDto(this.row(noteId)!);
  }

  private clear(noteId: string, row: LinkMetaRow) {
    this.db.delete(linkMeta).where(eq(linkMeta.noteId, noteId)).run();
    this.store.delete([row.imageFileId, row.faviconFileId]);
    refreshSearchText(this.db, noteId);
  }

  private searchText(noteId: string): string {
    const row = this.row(noteId);
    return row ? [row.title, row.siteName, row.description].filter(Boolean).join('\n') : '';
  }

  private metaFor(ids: string[]): Map<string, unknown> {
    const out = new Map<string, unknown>();
    if (ids.length === 0) return out;
    for (const row of this.db.select().from(linkMeta).where(inArray(linkMeta.noteId, ids)).all()) {
      out.set(row.noteId, toLinkMetaDto(row));
    }
    if (!this.config.linkPreviews) {
      const missing = ids.filter((id) => !out.has(id));
      const rows = missing.length
        ? this.db.select({ id: notes.id, content: notes.content }).from(notes).where(inArray(notes.id, missing)).all()
        : [];
      for (const row of rows) {
        const url = parseHttpUrl((row.content as LinkContent).url)?.toString() ?? '';
        out.set(row.id, { status: 'disabled', url } satisfies LinkMetaDto);
      }
    }
    return out;
  }

  private enqueue(noteId: string) {
    if (this.closed || this.queued.has(noteId)) return;
    this.queued.add(noteId);
    this.queue.push(noteId);
    this.pump();
  }

  private pump() {
    while (!this.closed && this.running < CONCURRENCY && this.queue.length > 0) {
      const noteId = this.queue.shift()!;
      this.queued.delete(noteId);
      this.running++;
      void this.process(noteId)
        .catch((err) => this.log.error({ err, noteId }, 'link preview failed'))
        .finally(() => {
          this.running--;
          this.pump();
          if (this.running === 0 && this.queue.length === 0) this.idleWaiters.splice(0).forEach((r) => r());
        });
    }
  }

  private async process(noteId: string) {
    const start = this.row(noteId);
    if (!start || start.status !== 'pending') return;
    const url = start.url;
    const allowPrivate = this.config.linkPreviewAllowLan;

    let result: { md: PageMetadata; finalUrl: string; contentType: string; thumb: Buffer | null; icon: Awaited<ReturnType<typeof makeIcon>> };
    try {
      const page = await this.fetchPageCached(url);
      if (page.status >= 400) throw new FetchError(`The site answered with HTTP ${page.status}`);
      if (page.contentType.includes('html') && looksBlocked(page.status, page.body.toString('utf8', 0, 50_000))) {
        throw new FetchError(this.flare ? 'The site showed a robot check, also to FlareSolverr' : 'The site showed a robot check instead of the page');
      }

      const isHtml = page.contentType.includes('html') || (!page.contentType && page.body.subarray(0, 512).toString().includes('<'));
      const isImage = page.contentType.startsWith('image/');
      let md: PageMetadata = isHtml
        ? extractMetadata(decodeHtml(page.body, page.contentType), page.finalUrl)
        : { icons: [new URL('/favicon.ico', page.finalUrl).toString()], jsonLd: [] };
      const githubApi = githubApiUrl(md);
      if (githubApi) md = await this.fromGitHubApi(githubApi, md);

      // Preview image: the link itself if it is an image, otherwise the page's og:image etc.
      let thumb: Buffer | null = null;
      try {
        if (isImage && !page.truncated) thumb = await makeThumbnail(page.body);
        else if (md.image) {
          const img = await safeFetch(md.image, { allowPrivate, maxBytes: IMAGE_MAX, accept: 'image/*' });
          if (img.status < 400 && !img.truncated && img.contentType.startsWith('image/')) thumb = await makeThumbnail(img.body);
        }
      } catch (err) {
        this.log.debug({ err, url }, 'preview image skipped');
      }

      let icon: Awaited<ReturnType<typeof makeIcon>> = null;
      for (const iconUrl of md.icons.slice(0, 3)) {
        try {
          const res = await safeFetch(iconUrl, { allowPrivate, maxBytes: ICON_MAX, accept: 'image/*' });
          if (res.status < 400 && !res.truncated && res.body.length > 0) icon = await makeIcon(res.body, res.contentType);
        } catch {
          // Try the next candidate.
        }
        if (icon) break;
      }
      result = { md, finalUrl: page.finalUrl, contentType: page.contentType.split(';')[0]!.trim(), thumb, icon };
    } catch (err) {
      if (this.closed) return;
      const message = err instanceof FetchError ? err.message : 'Could not load the page';
      if (!(err instanceof FetchError)) this.log.warn({ err, url }, 'link preview error');
      const current = this.row(noteId);
      if (current?.url === url) {
        this.db.update(linkMeta).set({ status: 'error', error: message, fetchedAt: new Date() }).where(eq(linkMeta.noteId, noteId)).run();
        this.onUpdate(noteId);
      }
      return;
    }

    // Commit only if the note still exists and still points at this URL.
    if (this.closed) return;
    const current = this.row(noteId);
    const note = this.db.select({ ownerId: notes.ownerId }).from(notes).where(eq(notes.id, noteId)).get();
    if (!current || current.url !== url || !note) return;

    const image = result.thumb
      ? this.store.save({ ownerId: note.ownerId, noteId, kind: 'link-image', mime: 'image/webp', ext: 'webp', data: result.thumb })
      : null;
    const favicon = result.icon
      ? this.store.save({ ownerId: note.ownerId, noteId, kind: 'link-icon', mime: result.icon.mime, ext: result.icon.ext, data: result.icon.data })
      : null;
    const { md } = result;
    this.db
      .update(linkMeta)
      .set({
        status: 'ok',
        error: null,
        finalUrl: result.finalUrl,
        title: md.title ?? null,
        description: md.description ?? null,
        siteName: md.siteName ?? new URL(result.finalUrl).hostname.replace(/^www\./, ''),
        ogType: md.ogType ?? null,
        contentType: result.contentType || null,
        imageFileId: image?.id ?? null,
        faviconFileId: favicon?.id ?? null,
        jsonLd: md.jsonLd.length ? md.jsonLd : null,
        fetchedAt: new Date(),
      })
      .where(eq(linkMeta.noteId, noteId))
      .run();
    this.store.delete([current.imageFileId, current.faviconFileId]);
    refreshSearchText(this.db, noteId);
    this.onUpdate(noteId);
  }
}
