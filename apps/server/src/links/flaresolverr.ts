import { request } from 'undici';
import { assertPublicUrl, FetchError, type SafeFetchResult } from './safe-fetch';

/**
 * Optional fallback for sites whose bot protection refuses plain HTTP clients: FlareSolverr
 * (https://github.com/FlareSolverr/FlareSolverr) loads the page in a real browser and returns
 * the HTML. Used after a normal fetch was refused, and for shop pages that only show their
 * product data once rendered (see needsBrowser); one page at a time.
 */

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const BLOCKED_STATUS = new Set([401, 403, 429, 503]);
const CHALLENGE_TITLE =
  /^(just a moment|attention required|access denied|please wait|checking your browser|one more step|security check|robot check|pardon our interruption|are you a (robot|human)|verify you are human|verify your identity|bot verification|prove your humanity|reddit - prove)/i;
/**
 * Markers of challenge pages that keep the site's normal (or an empty) title: Amazon captcha,
 * PerimeterX ("press and hold"; Walmart writes the id without quotes), and the AWS WAF
 * JavaScript challenge (IMDb answers HTTP 202 with it).
 */
const CHALLENGE_BODY =
  /action\s*=\s*["'][^"']*\/errors\/validateCaptcha|\sid\s*=\s*["']?px-captcha(?=["'\s>])|\sid\s*=\s*["']challenge-container["']|AwsWafIntegration\./i;
/** Seconds the browser waits for a JavaScript challenge FlareSolverr does not recognise itself. */
const CHALLENGE_WAIT_S = 6;

/** A response that looks like bot protection rather than the page. */
export function looksBlocked(status: number, html: string | undefined): boolean {
  if (BLOCKED_STATUS.has(status)) return true;
  if (!html) return false;
  const head = html.slice(0, 50_000);
  const title = /<title[^>]*>([^<]*)/i.exec(head)?.[1]?.trim() ?? '';
  return CHALLENGE_TITLE.test(title) || CHALLENGE_BODY.test(head);
}

interface SolverResponse {
  status?: string;
  message?: string;
  solution?: { url?: string; status?: number; response?: string };
}

export class FlareSolverr {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 60_000,
  ) {}

  /** Fetch a page through FlareSolverr. Requests are serialised: each one runs a browser. */
  fetch(url: string, opts: { allowPrivate: boolean; maxBytes: number }): Promise<SafeFetchResult> {
    const attempt = async () => {
      const first = await this.solve(url, opts);
      if (!looksBlocked(first.status, first.body.toString('utf8', 0, 50_000))) return first;
      // Some challenges (AWS WAF) are not recognised by FlareSolverr, which then returns the
      // challenge page right away. Given a few seconds, the browser solves it and loads the page.
      return this.solve(url, opts, CHALLENGE_WAIT_S);
    };
    const run = this.queue.then(attempt, attempt);
    this.queue = run.catch(() => {});
    return run;
  }

  private async solve(url: string, opts: { allowPrivate: boolean; maxBytes: number }, waitInSeconds?: number): Promise<SafeFetchResult> {
    // FlareSolverr usually runs on the LAN, so it must never be pointed at private addresses
    // unless the admin allowed that for previews anyway.
    await assertPublicUrl(url, opts.allowPrivate);

    let text: string;
    try {
      const res = await request(new URL('/v1', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: this.timeoutMs, ...(waitInSeconds && { waitInSeconds }) }),
        signal: AbortSignal.timeout(this.timeoutMs + 15_000 + (waitInSeconds ?? 0) * 1000),
        headersTimeout: this.timeoutMs + 10_000 + (waitInSeconds ?? 0) * 1000,
        bodyTimeout: this.timeoutMs + 10_000,
      });
      res.body.on('error', () => {});
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += (chunk as Buffer).length;
        if (size > MAX_RESPONSE_BYTES) throw new FetchError('FlareSolverr returned too much data');
        chunks.push(chunk as Buffer);
      }
      text = Buffer.concat(chunks).toString('utf8');
    } catch (err) {
      if (err instanceof FetchError) throw err;
      const e = err as { name?: string };
      if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new FetchError('FlareSolverr took too long');
      throw new FetchError('FlareSolverr could not be reached');
    }

    let data: SolverResponse;
    try {
      data = JSON.parse(text) as SolverResponse;
    } catch {
      throw new FetchError('FlareSolverr sent an unexpected answer');
    }
    const solution = data.solution;
    if (data.status !== 'ok' || !solution) throw new FetchError(`FlareSolverr: ${data.message ?? 'the page could not be loaded'}`);

    // The browser may have followed redirects; refuse results that ended up on a private address.
    const finalUrl = solution.url || url;
    await assertPublicUrl(finalUrl, opts.allowPrivate);

    const html = Buffer.from(solution.response ?? '', 'utf8');
    return {
      finalUrl,
      status: solution.status ?? 200,
      // FlareSolverr returns the page as rendered HTML text, already decoded.
      contentType: 'text/html; charset=utf-8',
      body: html.subarray(0, opts.maxBytes),
      truncated: html.length > opts.maxBytes,
    };
  }
}
