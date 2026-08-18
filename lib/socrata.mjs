// Socrata (Tyler Data & Insights) client. COPY, DON'T IMPORT — see TOOLKIT.md.
//
// Companion to patterns/socrata.md, which explains WHY each of these shapes is
// what it is. This file is the executable form of that document.
//
// Every function takes a source descriptor: { host, dataset }
//   host    'data.lacity.org'  (no scheme)
//   dataset 'abcd-1234'        (the four-four identifier)
//
// URL builders are exported separately from the fetchers so they can be unit
// tested without touching the network — the tests assert the query strings.

import { fetchJson } from './http.mjs';

const base = ({ host, dataset }) => `https://${host}/resource/${dataset}.json`;

/** Build a SoQL URL. Params with null/undefined values are omitted. */
export function buildUrl(src, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    qs.set(k.startsWith('$') ? k : `$${k}`, String(v));
  }
  const q = qs.toString();
  return q ? `${base(src)}?${q}` : base(src);
}

/** The dataset's column names and TYPES, from the catalog metadata endpoint. */
export function schemaUrl({ host, dataset }) {
  return `https://${host}/api/views/${dataset}.json`;
}

/**
 * Column list: [{ name, type, description }].
 * `type` matters more than it looks: a date stored as `text` sorts
 * lexicographically, so max() over it returns "9/7/2019" as the newest row in a
 * dataset that actually runs to 2023. See looksLikeStringDate() in clean.mjs.
 */
export async function schema(src, opts = {}) {
  const { json } = await fetchJson(schemaUrl(src), opts);
  const cols = json.columns ?? [];
  return cols.map(c => ({
    name: c.fieldName ?? c.name,
    type: c.dataTypeName ?? 'unknown',
    description: c.description ?? '',
  }));
}

/**
 * Row count for a predicate. ALWAYS count before you fetch: it is cheap, it
 * tells you whether the predicate is plausible, and it stops a silent
 * truncation from looking like a quiet week.
 */
export async function count(src, where = null, opts = {}) {
  const url = buildUrl(src, { select: 'count(*) as n', where });
  const { json } = await fetchJson(url, opts);
  const n = Number(json?.[0]?.n);
  return Number.isFinite(n) ? n : null;
}

/**
 * The newest value of a date field, as the source reports it.
 * Ask the DATA, never the catalog's `updatedAt` — that reflects file touches and
 * has read "yesterday" on datasets frozen for years.
 */
export async function maxDate(src, field, where = null, opts = {}) {
  const url = buildUrl(src, { select: `max(${field}) as newest`, where });
  const { json } = await fetchJson(url, opts);
  return json?.[0]?.newest ?? null;
}

/** One page of rows. `limit` is explicit on purpose: the default is small. */
export async function rows(src, { where, select, order, limit = 1000, offset = 0 } = {}, opts = {}) {
  const url = buildUrl(src, { where, select, order, limit, offset });
  const { json } = await fetchJson(url, opts);
  return Array.isArray(json) ? json : [];
}

/**
 * Group-by counts, ordered descending. This is the cross-check that exposes the
 * padding trap: if `WHERE name='Harbor'` returns 0 but the group-by shows 4,285
 * rows under a value that *looks* like 'Harbor', the field is padded.
 */
export async function groupCounts(src, field, { where = null, limit = 50 } = {}, opts = {}) {
  const url = buildUrl(src, {
    select: `${field}, count(*) as n`,
    where,
    group: field,
    order: 'n DESC',
    limit,
  });
  const { json } = await fetchJson(url, opts);
  return (Array.isArray(json) ? json : []).map(r => ({
    value: r[field],
    n: Number(r.n),
  }));
}

/**
 * Fetch every matching row, paging by $offset.
 * Returns { rows, truncated, pages }. `truncated` is the honest signal that you
 * hit the cap and are looking at a PREFIX of the data — never treat a truncated
 * result as a complete count.
 */
export async function paginate(src, { where, select, order, pageSize = 5000, maxRows = 100000 } = {}, opts = {}) {
  const out = [];
  let offset = 0;
  let pages = 0;

  for (;;) {
    const page = await rows(src, { where, select, order, limit: pageSize, offset }, opts);
    pages++;
    out.push(...page);
    if (page.length < pageSize) return { rows: out, truncated: false, pages };
    if (out.length >= maxRows) {
      return { rows: out.slice(0, maxRows), truncated: true, pages };
    }
    offset += pageSize;
  }
}
