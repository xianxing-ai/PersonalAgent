import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {HttpFeedProvider, MAX_BODY_BYTES, MAX_REDIRECTS, makeErrorRedactor} from '../dist/index.js';
import {ProtocolError} from '@personal-agent/contracts';

const FEED_URL = 'https://feeds.example.com/blog.xml';
const TOKEN_URL = 'https://private.example.com/feed.xml?token=SUPER-SECRET-TOKEN-VALUE&format=rss';
const TOKEN = 'SUPER-SECRET-TOKEN-VALUE';
const RSS = readFileSync(new URL('./fixtures/sspai-rss.xml', import.meta.url), 'utf8');

const signal = () => new AbortController().signal;

/** Header lookup is case-insensitive on a real Response, and the provider always asks in lower case. */
const makeHeaders = (raw = {}) => {
  const table = new Map(Object.entries(raw).map(([name, value]) => [name.toLowerCase(), value]));
  return {get: name => table.get(name.toLowerCase()) ?? null};
};

/** A buffered response: `body` is null, so `readBody` has to fall back to `text()`. */
const buffered = (body, status = 200, headers = {}) => ({
  status, headers: makeHeaders(headers), body: null, text: async () => body,
});

/**
 * A streamed response, which is what Node's fetch actually returns. `cancelCalls` is how a test
 * proves the socket is released rather than left half-read.
 */
const streamed = (chunks, status = 200, headers = {}) => {
  const state = {cancelCalls: 0, reads: 0};
  return {
    state,
    response: {
      status,
      headers: makeHeaders(headers),
      text: async () => { throw new Error('text() must not be used when a stream is present'); },
      body: {
        getReader: () => ({
          read: async () => {
            const value = chunks[state.reads++];
            return value === undefined ? {done: true} : {done: false, value: Buffer.from(value, 'utf8')};
          },
          cancel: () => { state.cancelCalls++; },
        }),
      },
    },
  };
};

/** Responses are consumed in order so a redirect chain is expressed as a plain list. */
const stubFetch = (...responses) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({url, init});
    const next = responses[calls.length - 1];
    if (next === undefined) throw new Error(`Unrouted fetch #${calls.length}: ${url}`);
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  impl.calls = calls;
  return impl;
};

const makeProvider = (responses, options = {}) => {
  const impl = stubFetch(...responses);
  return {impl, provider: new HttpFeedProvider({fetchImpl: impl, ...options})};
};

const transportError = (message, code, causeMessage) => {
  const error = new TypeError(message);
  if (code !== undefined || causeMessage !== undefined) {
    const cause = new Error(causeMessage ?? message);
    if (code !== undefined) cause.code = code;
    error.cause = cause;
  }
  return error;
};

// ---------------------------------------------------------------- identity and conditional requests

test('identifies itself and asks for a feed rather than a web page', async () => {
  const {impl, provider} = makeProvider([buffered(RSS)]);
  const result = await provider.fetchFeed({url: FEED_URL}, signal());

  assert.equal(provider.source, 'http-feeds');
  assert.equal(provider.verification, 'conditional');
  assert.equal(result.state, 'fetched');
  assert.equal(result.body, RSS);

  const headers = impl.calls[0].init.headers;
  assert.match(headers['user-agent'], /^personal-agent-feeds\//, 'a source must be able to tell who is polling');
  assert.match(headers.accept, /application\/rss\+xml/);
  assert.match(headers.accept, /application\/atom\+xml/);
  assert.equal(impl.calls[0].init.redirect, 'manual', 'redirects are followed by hand so each hop is re-checked');
  assert.equal('if-none-match' in headers, false);
  assert.equal('if-modified-since' in headers, false);
});

test('sends the cursor validators as conditional headers and reports the ones it got back', async () => {
  const {impl, provider} = makeProvider([buffered(RSS, 200, {etag: '"new"', 'last-modified': 'Sat, 05 Sep 2026 18:00:00 GMT'})]);
  const result = await provider.fetchFeed({url: FEED_URL, etag: '"old"', lastModified: 'Fri, 04 Sep 2026 18:00:00 GMT'}, signal());

  assert.equal(impl.calls[0].init.headers['if-none-match'], '"old"');
  assert.equal(impl.calls[0].init.headers['if-modified-since'], 'Fri, 04 Sep 2026 18:00:00 GMT');
  assert.equal(result.etag, '"new"');
  assert.equal(result.lastModified, 'Sat, 05 Sep 2026 18:00:00 GMT');
});

test('a 304 reports unchanged and keeps the validators that were sent when the reply omits them', async () => {
  const {provider} = makeProvider([buffered('', 304)]);
  const result = await provider.fetchFeed({url: FEED_URL, etag: '"old"', lastModified: 'Fri, 04 Sep 2026 18:00:00 GMT'}, signal());

  assert.deepEqual(result, {state: 'unchanged', etag: '"old"', lastModified: 'Fri, 04 Sep 2026 18:00:00 GMT'});
  assert.equal(result.body, undefined, 'a 304 has no body, and inventing one would be a lie about the source');
});

test('a 304 that carries refreshed validators reports the refreshed ones', async () => {
  const {provider} = makeProvider([buffered('', 304, {'last-modified': 'Sat, 05 Sep 2026 18:00:00 GMT'})]);
  const result = await provider.fetchFeed({url: FEED_URL, etag: '"old"', lastModified: 'Fri, 04 Sep 2026 18:00:00 GMT'}, signal());
  assert.equal(result.lastModified, 'Sat, 05 Sep 2026 18:00:00 GMT');
  assert.equal(result.etag, '"old"');
});

test('a source with no validators at all is reported as such', async () => {
  const {provider} = makeProvider([buffered(RSS)]);
  const result = await provider.fetchFeed({url: FEED_URL}, signal());
  assert.deepEqual(Object.keys(result).sort(), ['body', 'state'], 'no etag or lastModified key may be present');
});

// ---------------------------------------------------------------- status mapping

test('maps each status to the code a polling host can act on', async () => {
  const cases = [
    [404, 'NOT_FOUND', false, undefined],
    [410, 'NOT_FOUND', false, undefined],
    // Not UNAUTHORIZED: the manifest declares no authentication, so there is no credential state to
    // repair. On a public feed a 403 is almost always bot filtering, which retrying will not fix.
    [403, 'EXTERNAL_FAILURE', false, undefined],
    [401, 'EXTERNAL_FAILURE', false, undefined],
    [408, 'TIMEOUT', true, undefined],
    [500, 'EXTERNAL_FAILURE', true, undefined],
    [503, 'EXTERNAL_FAILURE', true, undefined],
    [418, 'EXTERNAL_FAILURE', false, undefined],
  ];
  for (const [status, code, retryable] of cases) {
    const {provider} = makeProvider([buffered('', status)]);
    await assert.rejects(
      provider.fetchFeed({url: FEED_URL}, signal()),
      error => {
        assert.equal(error.code, code, `status ${status}`);
        assert.equal(error.retryable, retryable, `status ${status} retryable`);
        assert.match(error.message, new RegExp(String(status)), 'the status is the actionable part and stays');
        return true;
      },
      `status ${status}`,
    );
  }
});

test('a 429 carries a bounded retry delay from either Retry-After spelling', async () => {
  const seconds = makeProvider([buffered('', 429, {'retry-after': '120'})]);
  await assert.rejects(seconds.provider.fetchFeed({url: FEED_URL}, signal()), {code: 'RATE_LIMITED', retryable: true, retryAfterMs: 120_000});

  const absent = makeProvider([buffered('', 429)]);
  await assert.rejects(absent.provider.fetchFeed({url: FEED_URL}, signal()), {code: 'RATE_LIMITED', retryAfterMs: 60_000});

  // IMF-fixdate is the other legal spelling, and is resolved against the real clock.
  const when = new Date(Date.now() + 120_000).toUTCString();
  const date = makeProvider([buffered('', 429, {'retry-after': when})]);
  let delay = -1;
  await assert.rejects(date.provider.fetchFeed({url: FEED_URL}, signal()), error => { delay = error.retryAfterMs; return true; });
  assert.ok(delay >= 100_000 && delay <= 125_000, `expected roughly 120s, got ${delay}`);

  const nonsense = makeProvider([buffered('', 429, {'retry-after': 'soon'})]);
  await assert.rejects(nonsense.provider.fetchFeed({url: FEED_URL}, signal()), {code: 'RATE_LIMITED', retryAfterMs: 60_000});

  // A hostile or broken source must not be able to make the host sleep for a year.
  const huge = makeProvider([buffered('', 429, {'retry-after': '999999999'})]);
  await assert.rejects(huge.provider.fetchFeed({url: FEED_URL}, signal()), {code: 'RATE_LIMITED', retryAfterMs: 86_400_000});
});

// ---------------------------------------------------------------- redirects

test('follows a relative redirect and keeps the conditional headers on the second hop', async () => {
  const {impl, provider} = makeProvider([
    buffered('', 302, {location: '/moved.xml'}),
    buffered(RSS, 200, {etag: '"e"'}),
  ]);
  const result = await provider.fetchFeed({url: FEED_URL, etag: '"old"'}, signal());

  assert.equal(result.state, 'fetched');
  assert.equal(impl.calls.length, 2);
  assert.equal(impl.calls[1].url, 'https://feeds.example.com/moved.xml');
  assert.equal(impl.calls[1].init.headers['if-none-match'], '"old"', 'the document moved, not its validators');
});

test('refuses a redirect off http(s) at every hop instead of only the first', async () => {
  const {impl, provider} = makeProvider([
    buffered('', 302, {location: 'https://other.example.com/ok.xml'}),
    buffered('', 302, {location: 'file:///etc/passwd'}),
    buffered(RSS),
  ]);
  await assert.rejects(
    provider.fetchFeed({url: FEED_URL}, signal()),
    {code: 'EXTERNAL_FAILURE', retryable: false},
  );
  assert.equal(impl.calls.length, 2, 'the file: hop must never be requested');
});

test('stops at the redirect cap rather than looping forever', async () => {
  const loop = () => buffered('', 302, {location: '/again.xml'});
  const {impl, provider} = makeProvider([loop(), loop(), loop(), loop(), loop()]);
  await assert.rejects(provider.fetchFeed({url: FEED_URL}, signal()), {code: 'EXTERNAL_FAILURE', retryable: true});
  assert.equal(impl.calls.length, MAX_REDIRECTS + 1);
  assert.equal(MAX_REDIRECTS, 3, 'the documented cap');
});

test('a redirect with no usable Location is a failure, not a silent stop', async () => {
  // Blank resolves back to the request URL, so following it would be a self-redirect loop reported
  // as a loop instead of as the malformed header it is.
  const missing = makeProvider([buffered('', 302)]);
  await assert.rejects(missing.provider.fetchFeed({url: FEED_URL}, signal()), {code: 'EXTERNAL_FAILURE', retryable: true});
  assert.equal(missing.impl.calls.length, 1);

  const blank = makeProvider([buffered('', 302, {location: '   '})]);
  await assert.rejects(blank.provider.fetchFeed({url: FEED_URL}, signal()), {code: 'EXTERNAL_FAILURE', retryable: true});
  assert.equal(blank.impl.calls.length, 1, 'a blank Location must never be followed');

  const unparseable = makeProvider([buffered('', 307, {location: 'http://'})]);
  await assert.rejects(unparseable.provider.fetchFeed({url: FEED_URL}, signal()), {code: 'EXTERNAL_FAILURE', retryable: false});
  assert.equal(unparseable.impl.calls.length, 1);
});

// ---------------------------------------------------------------- body limits

test('caps the body by declared length before reading any of it', async () => {
  const {impl, provider} = makeProvider([buffered('', 200, {'content-length': '999999999'})], {maxBodyBytes: 1024});
  await assert.rejects(provider.fetchFeed({url: FEED_URL}, signal()), {code: 'EXTERNAL_FAILURE', retryable: false});
  assert.equal(impl.calls.length, 1);
});

test('caps a streamed body per chunk when the source declares no length', async () => {
  // Chunked encoding omits Content-Length, and a gzip body reports its compressed size, so the only
  // honest place to enforce the cap is while reading.
  const chunks = ['<rss>'.padEnd(400, 'x'), 'y'.repeat(400), 'z'.repeat(400)];
  const {state, response} = streamed(chunks);
  const provider = new HttpFeedProvider({fetchImpl: stubFetch(response), maxBodyBytes: 1000});
  await assert.rejects(provider.fetchFeed({url: FEED_URL}, signal()), error => {
    assert.equal(error.code, 'EXTERNAL_FAILURE');
    assert.equal(error.retryable, false);
    assert.match(error.message, /1000 byte limit/);
    return true;
  });
  assert.equal(state.cancelCalls, 1, 'the socket must be released rather than left half-read');
});

test('releases the stream after a successful read too', async () => {
  const {state, response} = streamed([RSS]);
  const provider = new HttpFeedProvider({fetchImpl: stubFetch(response)});
  const result = await provider.fetchFeed({url: FEED_URL}, signal());
  assert.equal(result.body, RSS);
  assert.equal(state.cancelCalls, 1);
});

test('a stream cancel that throws does not replace the error the caller needs', async () => {
  const response = {
    status: 200,
    headers: makeHeaders({}),
    text: async () => '',
    body: {getReader: () => ({read: async () => { throw new Error('socket reset'); }, cancel: () => { throw new Error('cancel failed too'); }})},
  };
  const provider = new HttpFeedProvider({fetchImpl: stubFetch(response)});
  await assert.rejects(provider.fetchFeed({url: FEED_URL}, signal()), error => {
    assert.equal(error.code, 'EXTERNAL_FAILURE');
    assert.match(error.message, /socket reset/);
    assert.equal(error.message.includes('cancel failed too'), false);
    return true;
  });
});

test('falls back to text() when the implementation buffers, and still caps it', async () => {
  const ok = makeProvider([buffered(RSS)]);
  assert.equal((await ok.provider.fetchFeed({url: FEED_URL}, signal())).body, RSS);

  const tooBig = makeProvider([buffered('a'.repeat(2048))], {maxBodyBytes: 1024});
  await assert.rejects(tooBig.provider.fetchFeed({url: FEED_URL}, signal()), {code: 'EXTERNAL_FAILURE', retryable: false});
});

test('the default body cap is the documented one', () => {
  assert.equal(MAX_BODY_BYTES, 5_000_000);
});

// ---------------------------------------------------------------- transport failures

test('classifies transport failures by whether retrying can help', async () => {
  const cases = [
    [transportError('fetch failed', 'UND_ERR_HEADERS_TIMEOUT'), 'TIMEOUT', true],
    [transportError('fetch failed', 'ETIMEDOUT'), 'TIMEOUT', true],
    // The exact failure github.com produced on this machine during planning.
    [transportError('fetch failed', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'), 'EXTERNAL_FAILURE', false],
    [transportError('fetch failed', 'DEPTH_ZERO_SELF_SIGNED_CERT'), 'EXTERNAL_FAILURE', false],
    [transportError('fetch failed', 'ENOTFOUND'), 'EXTERNAL_FAILURE', true],
    [transportError('fetch failed', 'ECONNRESET'), 'EXTERNAL_FAILURE', true],
  ];
  for (const [failure, code, retryable] of cases) {
    const {provider} = makeProvider([() => { throw failure; }]);
    await assert.rejects(
      provider.fetchFeed({url: FEED_URL}, signal()),
      error => {
        assert.equal(error.code, code, failure.cause.code);
        assert.equal(error.retryable, retryable, failure.cause.code);
        assert.match(error.message, new RegExp(failure.cause.code), 'the code is the actionable part');
        return true;
      },
    );
  }
});

test('an aborted signal is reported as cancellation, not as a source failure', async () => {
  const abortedBefore = new AbortController();
  abortedBefore.abort();
  const {impl, provider} = makeProvider([buffered(RSS)]);
  await assert.rejects(provider.fetchFeed({url: FEED_URL}, abortedBefore.signal), {code: 'CANCELLED'});
  assert.equal(impl.calls.length, 0, 'a cancelled poll must not reach the network');

  // Aborted part-way through the body: the transport error is a consequence of the cancellation.
  const midRead = new AbortController();
  const throwing = makeProvider([() => { midRead.abort(); throw transportError('fetch failed', 'ECONNRESET'); }]);
  await assert.rejects(throwing.provider.fetchFeed({url: FEED_URL}, midRead.signal), {code: 'CANCELLED'});
});

test('rejects a URL it cannot parse or must not fetch', async () => {
  const {impl, provider} = makeProvider([buffered(RSS)]);
  await assert.rejects(provider.fetchFeed({url: 'not a url'}, signal()), {code: 'INVALID_ARGUMENT', retryable: false});
  await assert.rejects(provider.fetchFeed({url: 'file:///etc/passwd'}, signal()), {code: 'INVALID_ARGUMENT', retryable: false});
  await assert.rejects(provider.fetchFeed({url: 'ftp://feeds.example.com/blog.xml'}, signal()), {code: 'INVALID_ARGUMENT', retryable: false});
  assert.equal(impl.calls.length, 0);
});

// ---------------------------------------------------------------- credential handling

test('a transport failure never carries the configured URL, its token or its host', async () => {
  // The shape Node really produces: the URL appears in both the outer message and the cause.
  const failure = transportError(
    `fetch failed for ${TOKEN_URL}`,
    'ENOTFOUND',
    `getaddrinfo ENOTFOUND private.example.com while requesting ${TOKEN_URL}`,
  );
  const {provider} = makeProvider([() => { throw failure; }]);
  let message = '';
  try { await provider.fetchFeed({url: TOKEN_URL}, signal()); } catch (error) { message = error.message; }

  assert.ok(message.length > 0);
  assert.equal(message.includes(TOKEN), false, `token leaked: ${message}`);
  assert.equal(message.includes('private.example.com'), false, `host leaked: ${message}`);
  assert.equal(message.includes('token='), false, `query leaked: ${message}`);
  assert.equal(message.includes('feed.xml'), false, `path leaked: ${message}`);
  assert.match(message, /ENOTFOUND/, 'the classification survives redaction');
});

test('a bare host with no scheme is redacted too, and only where it stands alone', () => {
  const redact = makeErrorRedactor(new URL(TOKEN_URL));
  // Node's DNS error names the host without a scheme, so neither the href needle nor the
  // absolute-URL sweep reaches it.
  assert.equal(redact('getaddrinfo ENOTFOUND private.example.com'), 'getaddrinfo ENOTFOUND <redacted-host>');
  assert.equal(redact('see https://private.example.com/feed.xml?token=x'), 'see <redacted-url>');
  // A word that merely contains the host must survive, or redaction corrupts the diagnosis.
  assert.equal(redact('not private.example.commercial at all'), 'not private.example.commercial at all');

  const neutral = makeErrorRedactor(new URL(FEED_URL));
  assert.equal(neutral('connect ECONNREFUSED feeds.example.com'), 'connect ECONNREFUSED <redacted-host>');
  assert.equal(makeErrorRedactor(null)('connect ECONNREFUSED feeds.example.com'), 'connect ECONNREFUSED feeds.example.com');
});

test('a credential-looking query pair from an unconfigured host is still neutralized', () => {
  const redact = makeErrorRedactor(new URL(FEED_URL));
  const out = redact('rejected: https://cdn.other.example.com/f?api_key=abc123def456');
  assert.equal(out.includes('abc123def456'), false, out);
});

test('the status and redirect failures name no URL either', async () => {
  const status = makeProvider([buffered('', 403)]);
  let message = '';
  try { await status.provider.fetchFeed({url: TOKEN_URL}, signal()); } catch (error) { message = error.message; }
  assert.equal(message.includes(TOKEN), false);
  assert.equal(message.includes('private.example.com'), false);

  const redirect = makeProvider([buffered('', 302, {location: `https://other.example.com/x?token=${TOKEN}`})]);
  let redirected = '';
  try { await redirect.provider.fetchFeed({url: FEED_URL}, signal()); } catch (error) { redirected = error.message; }
  assert.equal(redirected.includes('other.example.com'), false, redirected);
});

test('an oversize body reports the limit, not the source content', async () => {
  const {provider} = makeProvider([buffered(`${TOKEN} ${TOKEN}`, 200, {'content-length': '99999999'})], {maxBodyBytes: 10});
  let message = '';
  try { await provider.fetchFeed({url: TOKEN_URL}, signal()); } catch (error) { message = error.message; }
  assert.equal(message.includes(TOKEN), false);
  assert.match(message, /10 byte limit/);
});

test('a ProtocolError is exported as one, so the host can read code and retryable', async () => {
  const {provider} = makeProvider([buffered('', 404)]);
  await assert.rejects(provider.fetchFeed({url: FEED_URL}, signal()), error => error instanceof ProtocolError);
});
