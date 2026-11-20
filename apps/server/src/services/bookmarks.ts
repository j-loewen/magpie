import { Parser } from 'htmlparser2';

export interface Bookmark {
  title: string;
  url: string;
  description: string;
  addedAt?: Date;
}

export interface BookmarkFolder {
  name: string;
  folders: BookmarkFolder[];
  links: Bookmark[];
}

/** Browser bookmark exports (Chrome, Firefox, Edge, Safari) all use the old Netscape format. */
export const isBookmarksFile = (html: string) =>
  /<!DOCTYPE\s+NETSCAPE-Bookmark-file/i.test(html) || /<DT>\s*<A\s[^>]*HREF\s*=/i.test(html);

const toDate = (seconds: string | undefined) => {
  const n = Number(seconds);
  // Ignore missing or implausible timestamps (some exporters write microseconds or 0).
  return Number.isFinite(n) && n > 0 && n < 4_102_444_800 ? new Date(n * 1000) : undefined;
};

/**
 * Netscape bookmark file:
 *   <DL><p>
 *     <DT><H3>Folder</H3>
 *     <DL><p> <DT><A HREF="…" ADD_DATE="…">Title</A> <DD>Description … </DL><p>
 *   </DL>
 * DT, DD and P are never closed, so only DL nesting is trusted for structure.
 */
export function parseBookmarks(html: string): BookmarkFolder {
  const root: BookmarkFolder = { name: '', folders: [], links: [] };
  const stack: BookmarkFolder[] = [];
  const current = () => stack[stack.length - 1] ?? root;
  /** Folder named by the last <H3>, waiting for its <DL>. */
  let pending: BookmarkFolder | null = null;
  let mode: 'h3' | 'a' | 'dd' | null = null;
  let text = '';
  let link: Bookmark | null = null;
  let lastLink: Bookmark | null = null;

  const finishDescription = () => {
    if (mode !== 'dd') return;
    if (lastLink) lastLink.description = text.replace(/\s+\n/g, '\n').trim();
    mode = null;
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (mode === 'dd' && name !== 'br') finishDescription();
        if (pending && (name === 'h3' || name === 'a')) {
          // The previous <H3> had no list of its own: an empty folder.
          current().folders.push(pending);
          pending = null;
        }
        if (name === 'h3') {
          mode = 'h3';
          text = '';
        } else if (name === 'a') {
          mode = 'a';
          text = '';
          link = { title: '', url: (attrs.href ?? '').trim(), description: '', addedAt: toDate(attrs.add_date) };
        } else if (name === 'dd') {
          mode = 'dd';
          text = '';
        } else if (name === 'br' && mode === 'dd') {
          text += '\n';
        } else if (name === 'dl') {
          if (pending) {
            current().folders.push(pending);
            stack.push(pending);
            pending = null;
          } else {
            stack.push(current());
          }
        }
      },
      ontext(chunk) {
        if (mode) text += chunk;
      },
      onclosetag(name) {
        if (name === 'h3' && mode === 'h3') {
          pending = { name: text.trim() || 'Folder', folders: [], links: [] };
          mode = null;
        } else if (name === 'a' && mode === 'a' && link) {
          link.title = text.trim();
          current().links.push(link);
          lastLink = link;
          link = null;
          mode = null;
        } else if (name === 'dl') {
          finishDescription();
          // An <H3> without its own list is an empty folder.
          if (pending) current().folders.push(pending);
          pending = null;
          stack.pop();
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  finishDescription();
  return root;
}
