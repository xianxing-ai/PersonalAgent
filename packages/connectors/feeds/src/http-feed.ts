import { ProtocolError } from '@personal-agent/contracts';
import type { FeedFetch, FeedFetchRequest, FeedProvider, FeedVerification } from './provider.js';
import { parseFeedDate } from './dates.js';
import { makeContentRedactor, makeErrorRedactor } from './redact.js';
import {credentialFreePublicUrl, feedSha256, sealFeedTransportReceipt} from './provenance.js';

export interface FeedBodyReader {
  read(): Promise<{done: boolean; value?: Uint8Array}>;
  cancel(): Promise<unknown> | unknown;
}

export interface FeedResponseLike {
  readonly status: number;
  readonly headers: {get(name: string): string | null};
  /** Absent on implementations that only buffer; `text()` is the fallback then. */
  readonly body: {getReader(): FeedBodyReader} | null;
  text(): Promise<string>;
}

export type FeedFetchLike = (
  url: string,
  init: {signal: AbortSignal; headers: Record<string, string>; redirect: 'manual'; credentials: 'omit'},
) => Promise<FeedResponseLike>;

export interface HttpFeedOptions {
  fetchImpl?: FeedFetchLike;
  userAgent?: string;
  maxBodyBytes?: number;
  maxRedirects?: number;
  /** Source label recorded on every item. */
  source?: string;
  verification?: FeedVerification;
}

export const MAX_BODY_BYTES = 5_000_000;
export const MAX_REDIRECTS = 3;
const USER_AGENT = 'personal-agent-feeds/0.1.0-alpha.1';
const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 86_400_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** A certificate problem does not fix itself on retry, so it is reported as non-retryable. */
const CERTIFICATE_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_CERT_AUTHORITY_INVALID',
]);

const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT', 'ECONNABORTED',
]);

function errorCode(error: unknown): string | null {
  for (const candidate of [error, error instanceof Error ? error.cause : undefined]) {
    if (candidate !== null && typeof candidate === 'object') {
      const code = (candidate as {code?: unknown}).code;
      if (typeof code === 'string' && code !== '') return code;
    }
  }
  return null;
}

function describeError(error: unknown, redact: (text: string) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  const text = [message, cause].filter(Boolean).join(': ');
  const code = errorCode(error);
  return code === null ? redact(text) : `${code}: ${redact(text)}`;
}

/**
 * Real HTTP transport for RSS 2.0 and Atom sources.
 *
 * Redirects are followed by hand with `redirect: 'manual'` so the scheme is re-checked at every
 * hop; letting `fetch` follow them would mean trusting the first hop's scheme for all of them.
 * There is no filtering of private or link-local address ranges: subscriptions are operator
 * configuration rather than model input, and the redirect target's *scheme* is the boundary this
 * module enforces. That limitation is documented in the README.
 */
export class HttpFeedProvider implements FeedProvider {
  readonly source: string;
  readonly verification: FeedVerification;
  private readonly fetchImpl: FeedFetchLike;
  private readonly userAgent: string;
  private readonly maxBodyBytes: number;
  private readonly maxRedirects: number;
  private readonly nativeFetch: boolean;

  constructor(options: HttpFeedOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FeedFetchLike);
    this.nativeFetch = options.fetchImpl === undefined;
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
    this.maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
    this.source = options.source ?? 'http-feeds';
    this.verification = options.verification ?? 'conditional';
  }

  async fetchFeed(request: FeedFetchRequest, signal: AbortSignal): Promise<FeedFetch> {
    let target: URL;
    try {
      target = new URL(request.url);
    } catch {
      throw new ProtocolError('INVALID_ARGUMENT', 'Feed URL is not a parseable absolute URL', false);
    }
    const redact = makeErrorRedactor(target);
    if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
      throw new ProtocolError('INVALID_ARGUMENT', `Feed URL must use http or https, not ${target.protocol.replace(':', '')}`, false);
    }
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Feed fetch cancelled', false);

    const headers: Record<string, string> = {'user-agent': this.userAgent, accept: ACCEPT};
    if (request.etag !== undefined) headers['if-none-match'] = request.etag;
    if (request.lastModified !== undefined) headers['if-modified-since'] = request.lastModified;

    let current = target;
    let credentialFree = credentialFreePublicUrl(target);
    for (let hop = 0;; hop++) {
      let response: FeedResponseLike;
      try {
        response = await this.fetchImpl(current.href, {signal, headers, redirect: 'manual', credentials: 'omit'});
      } catch (error) {
        throw this.transportFailure(error, signal, redact);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        if (hop >= this.maxRedirects) {
          throw new ProtocolError('EXTERNAL_FAILURE', `Feed redirected more than ${this.maxRedirects} times`, true);
        }
        const location = response.headers.get('location')?.trim();
        if (!location) {
          // Blank resolves back to the request URL, which would be a silent self-redirect loop that
          // only the hop cap stops, reported as a loop rather than as the malformed header it is.
          throw new ProtocolError('EXTERNAL_FAILURE', `Redirect status ${response.status} carried no usable Location header`, true);
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new ProtocolError('EXTERNAL_FAILURE', 'Redirect Location is not a usable URL', false);
        }
        if (!ALLOWED_PROTOCOLS.has(next.protocol)) {
          throw new ProtocolError('EXTERNAL_FAILURE', 'Feed redirected to a URL that is not http or https', false);
        }
        if (next.username || next.password || [...next.searchParams.keys()].some(key => /(?:token|session|key|secret|passw|auth|signature|sig|access)/iu.test(key))) {
          throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Credential-bearing feed redirects require a host-managed private transport', false);
        }
        current = next;
        credentialFree = credentialFree && credentialFreePublicUrl(next);
        continue;
      }

      const result = await this.readResponse(response, request, signal, redact);
      sealFeedTransportReceipt(result, {
        providerId: 'http-feed-provider-v1', nativeFetch: this.nativeFetch, credentialFree,
        state: result.state, transportFetchedAt: new Date().toISOString(),
        requestBinding: feedSha256(target.href),
        decodedBodySha256: result.body === undefined ? null : feedSha256(result.body),
      });
      return result;
    }
  }

  private transportFailure(error: unknown, signal: AbortSignal, redact: (text: string) => string): ProtocolError {
    if (signal.aborted) return new ProtocolError('CANCELLED', 'Feed fetch cancelled', false);
    const detail = describeError(error, redact);
    const code = errorCode(error);
    if ((code !== null && TIMEOUT_CODES.has(code)) || (error instanceof Error && error.name === 'TimeoutError')) {
      return new ProtocolError('TIMEOUT', `Feed request timed out (${detail})`, true);
    }
    if (code !== null && CERTIFICATE_CODES.has(code)) {
      return new ProtocolError('EXTERNAL_FAILURE', `Feed TLS certificate was rejected (${detail})`, false);
    }
    return new ProtocolError('EXTERNAL_FAILURE', `Feed request failed (${detail})`, true);
  }

  private async readResponse(response: FeedResponseLike, request: FeedFetchRequest, signal: AbortSignal, redact: (text: string) => string): Promise<FeedFetch> {
    const status = response.status;
    const contentRedact = makeContentRedactor(new URL(request.url));
    const safeValidator = (value: string | null): string | undefined =>
      value !== null && contentRedact(value) === value ? value : undefined;
    const etag = safeValidator(response.headers.get('etag'));
    const lastModified = safeValidator(response.headers.get('last-modified'));

    if (status === 304) {
      // A 304 may omit the validators, in which case the ones we sent still describe the document.
      const unchanged: FeedFetch = {state: 'unchanged'};
      const carriedEtag = etag ?? request.etag;
      const carriedModified = lastModified ?? request.lastModified;
      if (carriedEtag !== undefined) unchanged.etag = carriedEtag;
      if (carriedModified !== undefined) unchanged.lastModified = carriedModified;
      return unchanged;
    }

    if (status === 401 || status === 403) {
      // Not UNAUTHORIZED: the manifest declares no authentication, so there is no credential state
      // to repair. On public feeds a 403 is almost always bot filtering, which retrying will not fix.
      throw new ProtocolError('EXTERNAL_FAILURE', `Feed refused the request with status ${status}; the source is likely filtering automated clients`, false);
    }
    if (status === 404 || status === 410) {
      throw new ProtocolError('NOT_FOUND', `Feed is gone (status ${status})`, false);
    }
    if (status === 408) {
      throw new ProtocolError('TIMEOUT', 'Feed source request timed out (status 408)', true);
    }
    if (status === 429) {
      const retryAfterMs = retryAfterOf(response.headers.get('retry-after'));
      throw new ProtocolError('RATE_LIMITED', `Feed source is rate limiting this client (status 429)`, true, retryAfterMs);
    }
    if (status >= 500) {
      throw new ProtocolError('EXTERNAL_FAILURE', `Feed source returned status ${status}`, true);
    }
    if (status < 200 || status >= 300) {
      throw new ProtocolError('EXTERNAL_FAILURE', `Feed source returned unexpected status ${status}`, false);
    }
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Feed fetch cancelled', false);

    let body: string;
    try {
      body = await readBody(response, this.maxBodyBytes);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (signal.aborted) throw new ProtocolError('CANCELLED', 'Feed fetch cancelled', false);
      throw new ProtocolError('EXTERNAL_FAILURE', `Reading the feed body failed (${describeError(error, redact)})`, true);
    }
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Feed fetch cancelled', false);

    const fetched: FeedFetch = {state: 'fetched', body};
    if (etag !== undefined) fetched.etag = etag;
    if (lastModified !== undefined) fetched.lastModified = lastModified;
    return fetched;
  }
}

/** `Retry-After` is either delta-seconds or an HTTP-date; both are real, and both are bounded. */
function retryAfterOf(header: string | null): number {
  if (header === null) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number.parseInt(header.trim(), 10);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = parseFeedDate(header);
  if (date === null) return DEFAULT_RETRY_AFTER_MS;
  const delay = Date.parse(date) - Date.now();
  return Math.min(Math.max(delay, 0), MAX_RETRY_AFTER_MS);
}

function oversize(bytes: number, limit: number): ProtocolError {
  return new ProtocolError('EXTERNAL_FAILURE', `Feed body exceeds the ${limit} byte limit (read ${bytes} bytes)`, false);
}

async function readBody(response: FeedResponseLike, maxBytes: number): Promise<string> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) throw oversize(declared, maxBytes);

  const stream = response.body;
  if (stream === null) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) throw oversize(bytes, maxBytes);
    return text;
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflowed = false;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        chunks.push(value);
      }
      // Checked after each chunk rather than trusted from Content-Length: a source can omit the
      // header entirely, and a gzip-encoded body reports its compressed size.
      if (total > maxBytes) { overflowed = true; break; }
    }
  } finally {
    // Cancel even on success so the socket is released instead of left half-read. Wrapped in its
    // own try because a throw here would replace the error the caller actually needs to see.
    try {
      await reader.cancel();
    } catch {
      // Nothing left to do: the stream is already unusable.
    }
  }
  if (overflowed) throw oversize(total, maxBytes);

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}
