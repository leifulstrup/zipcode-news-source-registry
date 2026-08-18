// ArcGIS FeatureServer / MapServer client. COPY, DON'T IMPORT — see TOOLKIT.md.
//
// Companion to patterns/arcgis.md. Three things make ArcGIS different from
// Socrata and each has bitten a real adapter:
//
//   1. ERRORS ARRIVE INSIDE A 200. `{"error":{"code":400,...}}` with an HTTP 200.
//      fetchJson() in http.mjs raises on that; do not "simplify" it away.
//   2. THE DATE-LITERAL DIALECT VARIES PER SERVICE and documentation cannot tell
//      you which one a server accepts. DATE '2026-01-01', TIMESTAMP '...', and
//      raw epoch milliseconds are all real. probeDateDialect() finds out by
//      execution — the only method that works.
//   3. DATES COME BACK AS EPOCH MILLISECONDS, not strings. A max() that looks
//      like 1755000000000 is a date, not a count.
//
// Source descriptor: { service, layer }
//   service 'https://host/arcgis/rest/services/Path/MapServer'  (no layer id)
//   layer   0

import { fetchJson } from './http.mjs';

/**
 * encodeURIComponent leaves single quotes raw, and some ArcGIS servers reject
 * them in a where-clause. %27 is accepted everywhere.
 */
export const enc = w => encodeURIComponent(w).replace(/'/g, '%27');

const layerBase = ({ service, layer = 0 }) => `${service.replace(/\/$/, '')}/${layer}`;

/** Build a /query URL. Exported so tests can assert it without the network. */
export function buildQueryUrl(src, params = {}) {
  const parts = ['f=json'];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${k}=${k === 'where' ? enc(String(v)) : encodeURIComponent(String(v))}`);
  }
  return `${layerBase(src)}/query?${parts.join('&')}`;
}

/** The layer's metadata URL (fields, types, capabilities). */
export const layerUrl = src => `${layerBase(src)}?f=json`;

/**
 * Field list: [{ name, type, alias }]. ArcGIS types look like
 * 'esriFieldTypeDate' / 'esriFieldTypeString' / 'esriFieldTypeInteger'.
 * A date stored as esriFieldTypeString is the lexicographic-sort trap.
 */
export async function fields(src, opts = {}) {
  const { json } = await fetchJson(layerUrl(src), opts);
  return (json.fields ?? []).map(f => ({
    name: f.name,
    type: f.type ?? 'unknown',
    alias: f.alias ?? f.name,
  }));
}

/** Row count for a where-clause. Count before you fetch. */
export async function count(src, where = '1=1', opts = {}) {
  const url = buildQueryUrl(src, { where, returnCountOnly: 'true' });
  const { json } = await fetchJson(url, opts);
  return typeof json.count === 'number' ? json.count : null;
}

/**
 * Read an attribute case-insensitively.
 *
 * Some ArcGIS servers UPPERCASE outStatisticFieldName in the response: you ask
 * for `newest` and get back `NEWEST`. A case-sensitive lookup then returns
 * undefined, which reads as "no date" — the freshness check silently fails on
 * a perfectly healthy service. Observed live on a MapServer.
 */
export function attr(attributes, name) {
  if (!attributes) return undefined;
  if (name in attributes) return attributes[name];
  const key = Object.keys(attributes).find(k => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : attributes[key];
}

/**
 * max(field) via outStatistics. Returns an ISO date string when the field is a
 * real date (epoch ms in, ISO out), otherwise the raw value — which is your
 * signal that the field is stored as text and this number cannot be trusted as
 * "newest".
 */
export async function maxDate(src, field, where = '1=1', opts = {}) {
  const outStatistics = JSON.stringify([
    { statisticType: 'max', onStatisticField: field, outStatisticFieldName: 'newest' },
  ]);
  const url = buildQueryUrl(src, { where, outStatistics });
  const { json } = await fetchJson(url, opts);
  const v = attr(json.features?.[0]?.attributes, 'newest');
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
  return v; // string field: return raw, let the caller notice
}

/** One page of attribute rows. */
export async function rows(src, { where = '1=1', outFields = '*', orderByFields, limit = 1000, offset = 0 } = {}, opts = {}) {
  const url = buildQueryUrl(src, {
    where,
    outFields,
    orderByFields,
    resultRecordCount: limit,
    resultOffset: offset,
    returnGeometry: 'false',
  });
  const { json } = await fetchJson(url, opts);
  return (json.features ?? []).map(f => f.attributes);
}

/**
 * Group-by counts. The padding cross-check: compare an equality filter's count
 * against what the group-by actually shows.
 */
export async function groupCounts(src, field, { where = '1=1', limit = 50 } = {}, opts = {}) {
  const outStatistics = JSON.stringify([
    { statisticType: 'count', onStatisticField: field, outStatisticFieldName: 'n' },
  ]);
  const url = buildQueryUrl(src, {
    where,
    groupByFieldsForStatistics: field,
    outStatistics,
    orderByFields: 'n DESC',
    resultRecordCount: limit,
  });
  const { json } = await fetchJson(url, opts);
  return (json.features ?? []).map(f => ({
    value: attr(f.attributes, field),
    n: Number(attr(f.attributes, 'n')),
  }));
}

/** Page with resultOffset. Returns { rows, truncated, pages }. */
export async function paginate(src, { where = '1=1', outFields = '*', pageSize = 2000, maxRows = 100000 } = {}, opts = {}) {
  const out = [];
  let offset = 0;
  let pages = 0;

  for (;;) {
    const page = await rows(src, { where, outFields, limit: pageSize, offset }, opts);
    pages++;
    out.push(...page);
    if (page.length < pageSize) return { rows: out, truncated: false, pages };
    if (out.length >= maxRows) return { rows: out.slice(0, maxRows), truncated: true, pages };
    offset += pageSize;
  }
}

/**
 * Which date-literal dialect does THIS service accept?
 *
 * Documentation cannot answer this; only execution can. Returns
 * { dialect, example, tried } where dialect is 'DATE' | 'TIMESTAMP' | 'EPOCH' |
 * null. Run this once per service and hard-code the winner in your adapter with
 * a dated comment.
 */
export function dateDialectCandidates(field, isoDate) {
  const epochMs = Date.parse(`${isoDate}T00:00:00Z`);
  return [
    { dialect: 'DATE', where: `${field} > DATE '${isoDate}'` },
    { dialect: 'TIMESTAMP', where: `${field} > TIMESTAMP '${isoDate} 00:00:00'` },
    { dialect: 'EPOCH', where: `${field} > ${epochMs}` },
  ];
}

export async function probeDateDialect(src, field, isoDate, opts = {}) {
  const tried = [];
  for (const cand of dateDialectCandidates(field, isoDate)) {
    try {
      const n = await count(src, cand.where, opts);
      tried.push({ ...cand, ok: true, count: n });
      if (typeof n === 'number') return { dialect: cand.dialect, example: cand.where, tried };
    } catch (err) {
      tried.push({ ...cand, ok: false, error: err.message });
    }
  }
  return { dialect: null, example: null, tried };
}

/**
 * ArcGIS Hub portals: finding an organisation's content.
 *
 * Hub v3's `filter[orgid]` is REJECTED as an invalid parameter key. The route
 * that works is to read `orgId` off the portal page, then search the sharing API.
 */
export const hubSearchUrl = (orgId, terms) =>
  `https://www.arcgis.com/sharing/rest/search?f=json&num=100&q=` +
  encodeURIComponent(`orgid:${orgId} AND ${terms}`);
