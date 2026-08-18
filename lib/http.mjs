// HTTP with the defaults government data endpoints actually require.
//
// COPY THIS, DON'T IMPORT IT. See TOOLKIT.md — nothing in this repo is meant to
// be fetched and executed inside a publishing pipeline.
//
// Three behaviours here are not optional politeness; each is a failure mode
// observed on real municipal endpoints:
//
//   1. A browser-ish User-Agent. Some feeds return HTTP 200 with a ZERO-LENGTH
//      body to non-browser clients. A bare `Mozilla/5.0` is intermittently not
//      enough. That failure is indistinguishable from "no data" unless you look
//      at the body length, which is why assertNonEmptyBody() exists in checks.
//   2. One retry with backoff on 403/429/5xx. Public GIS endpoints 403 at random,
//      especially on long where-clauses. A 403 is not "no data" and not "dead" —
//      it is usually "ask again". A source that 403s consistently to every client
//      is `manual-only`, not `dead`.
//   3. A timeout. Some portals accept a connection and never answer. An
//      unattended weekly run must fail in bounded time, not hang.

export class HttpError extends Error {
  constructor(message, { status = null, url = null, body = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

// Real browsers send this shape. Government endpoints behind bot filters check it.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const RETRYABLE = new Set([403, 408, 429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetch text with timeout + one retry. Returns { text, status, ms, bytes, headers }.
 * Does NOT throw on a non-2xx that survived the retry — the caller decides
 * whether a 403 means "manual-only" or "dead". Throws HttpError only on
 * network/timeout failure, where there is no response to reason about.
 */
export async function fetchText(url, { timeoutMs = 20000, retries = 1, headers = {} } = {}) {
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: '*/*', ...headers },
      });
      const text = await res.text();
      const ms = Date.now() - started;

      if (RETRYABLE.has(res.status) && attempt < retries) {
        await sleep(1200 * (attempt + 1));
        continue;
      }

      return {
        text,
        status: res.status,
        ok: res.ok,
        ms,
        bytes: Buffer.byteLength(text),
        headers: Object.fromEntries(res.headers.entries()),
        url: res.url || url,
      };
    } catch (err) {
      lastErr = err;
      const aborted = err.name === 'AbortError';
      if (attempt < retries) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      throw new HttpError(
        aborted ? `timed out after ${timeoutMs}ms` : `network failure: ${err.message}`,
        { url },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new HttpError(`unreachable: ${lastErr?.message ?? 'unknown'}`, { url });
}

/**
 * Fetch JSON, throwing on the two ways these APIs report failure:
 *   - a non-2xx status
 *   - an `error` object inside a 200 body (ArcGIS does this; status codes are
 *     not the truth there)
 */
export async function fetchJson(url, opts = {}) {
  const res = await fetchText(url, opts);

  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, {
      status: res.status,
      url,
      body: res.text.slice(0, 400),
    });
  }
  if (res.text.trim() === '') {
    // A 200 with an empty body. Treated as failure on purpose: in a published
    // issue it becomes "nothing happened", which is a lie rather than a gap.
    throw new HttpError('HTTP 200 with an empty body', { status: 200, url });
  }

  let json;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new HttpError('response was not valid JSON', {
      status: res.status,
      url,
      body: res.text.slice(0, 400),
    });
  }

  // ArcGIS reports errors inside a 200. Socrata sometimes returns {error:true,message}.
  if (json && typeof json === 'object' && !Array.isArray(json) && json.error) {
    const msg =
      json.error?.message ??
      json.message ??
      (typeof json.error === 'string' ? json.error : JSON.stringify(json.error));
    throw new HttpError(`API error in a 200 response: ${msg}`, { status: 200, url });
  }

  return { json, meta: res };
}
