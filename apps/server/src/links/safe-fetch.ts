import dns from 'node:dns';
import net from 'node:net';
import { Agent, request, type Dispatcher } from 'undici';

/**
 * HTTP fetching for user-supplied URLs, hardened against SSRF:
 * - only http/https
 * - every connection (including after redirects) is checked at DNS-lookup time, so a hostname
 *   cannot resolve to a private/loopback/link-local address (also defeats DNS rebinding)
 * - redirect, size and time limits
 */

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses: check the embedded IPv4.
    const embedded = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (embedded) return blocked.check(embedded, 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

export class FetchError extends Error {
  constructor(
    message: string,
    /** The site turned the request away (dropped the connection); worth trying FlareSolverr. */
    readonly refused = false,
  ) {
    super(message);
  }
}

/** Connection errors of sites that cut off clients they take for bots (e.g. Akamai bot manager). */
const DROPPED = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ERR_HTTP2_STREAM_ERROR', 'ERR_HTTP2_SESSION_ERROR', 'ERR_HTTP2_STREAM_CANCEL']);

function guardedLookup(allowPrivate: boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = addresses as dns.LookupAddress[];
      const bad = !allowPrivate && list.find((a) => isPrivateAddress(a.address));
      if (bad || list.length === 0) {
        return callback(new FetchError('This address is not allowed (private network)'), '', 0);
      }
      if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

/**
 * Check a URL the same way safeFetch checks connections, for fetchers that connect by themselves
 * (FlareSolverr): http(s) only, and (unless allowed) no host that resolves to a private address.
 */
export async function assertPublicUrl(input: string, allowPrivate: boolean): Promise<void> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError('Invalid address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('Only http and https links are supported');
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host)
    ? [host]
    : await dns.promises.lookup(host, { all: true }).then(
        (list) => list.map((a) => a.address),
        () => {
          throw new FetchError('The site could not be found');
        },
      );
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new FetchError('This address is not allowed (private network)');
}

export interface SafeFetchOptions {
  allowPrivate: boolean;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

const agents = new Map<boolean, Agent>();
function agentFor(allowPrivate: boolean): Dispatcher {
  let agent = agents.get(allowPrivate);
  if (!agent) {
    agent = new Agent({
      connect: { lookup: guardedLookup(allowPrivate), timeout: 8000 },
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    agents.set(allowPrivate, agent);
  }
  return agent;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; MagpieLinkPreview/1.0)';

export async function safeFetch(input: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  let url = new URL(input);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('Only http and https links are supported');
    // Literal IPs skip DNS lookup, so check them here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!opts.allowPrivate && net.isIP(host) && isPrivateAddress(host)) {
      throw new FetchError('This address is not allowed (private network)');
    }
    let res: Dispatcher.ResponseData;
    try {
      res = await request(url, {
        method: 'GET',
        dispatcher: agentFor(opts.allowPrivate),
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: opts.accept ?? '*/*',
          'accept-language': 'en;q=0.9, *;q=0.5',
        },
      });
    } catch (err) {
      throw toFetchError(err);
    }

    // A body we stop reading is aborted, which emits 'error'; without a listener that would crash the process.
    res.body.on('error', () => {});

    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.body.destroy();
      url = new URL(String(res.headers.location), url);
      continue;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    try {
      for await (const chunk of res.body) {
        const buf = chunk as Buffer;
        if (size + buf.length > opts.maxBytes) {
          chunks.push(buf.subarray(0, opts.maxBytes - size));
          truncated = true;
          break; // leaving the loop destroys the stream
        }
        chunks.push(buf);
        size += buf.length;
      }
    } catch (err) {
      throw toFetchError(err);
    }
    return {
      finalUrl: url.toString(),
      status: res.statusCode,
      contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
      body: Buffer.concat(chunks),
      truncated,
    };
  }
  throw new FetchError('Too many redirects');
}

function toFetchError(err: unknown): FetchError {
  if (err instanceof FetchError) return err;
  const e = err as { name?: string; code?: string; cause?: unknown; message?: string };
  if (e.cause instanceof FetchError) return e.cause;
  if (e.name === 'TimeoutError' || e.name === 'AbortError' || e.code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new FetchError('The site took too long to respond');
  }
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return new FetchError('The site could not be found');
  if (e.code === 'ECONNREFUSED') return new FetchError('The site refused the connection');
  const cause = e.cause as { code?: string } | undefined;
  if (DROPPED.has(e.code ?? '') || DROPPED.has(cause?.code ?? '')) {
    return new FetchError('The site closed the connection (it may block link previews)', true);
  }
  if (e.code?.startsWith('ERR_TLS') || e.code?.includes('CERT')) return new FetchError('The site has an invalid HTTPS certificate');
  return new FetchError(e.message ? `Could not load the page: ${e.message}` : 'Could not load the page');
}
