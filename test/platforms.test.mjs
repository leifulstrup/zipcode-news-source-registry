// URL construction and response shaping — asserted without touching the network.
// Live-endpoint behaviour is proven by running bin/diagnose.mjs against a real
// source, not here: a unit test that needs the internet fails for reasons that
// have nothing to do with the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as socrata from '../lib/socrata.mjs';
import * as arcgis from '../lib/arcgis.mjs';
import { trimAll, dedupeBy, detectPadding, looksLikeStringDate, toDateISO } from '../lib/clean.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = f => JSON.parse(readFileSync(join(FIX, f), 'utf8'));

const SOC = { host: 'data.example.gov', dataset: 'abcd-1234' };
const AGS = { service: 'https://gis.example.gov/arcgis/rest/services/Crime/MapServer', layer: 39 };

/* ------------------------------------------------------------------ socrata */
test('socrata: count builds a SoQL count query', () => {
  const url = socrata.buildUrl(SOC, { select: 'count(*) as n', where: "zip_code='90706'" });
  assert.match(url, /^https:\/\/data\.example\.gov\/resource\/abcd-1234\.json\?/);
  const q = new URL(url).searchParams;
  assert.equal(q.get('$select'), 'count(*) as n');
  assert.equal(q.get('$where'), "zip_code='90706'");
});

test('socrata: buildUrl omits empty params and prefixes $ once', () => {
  const url = socrata.buildUrl(SOC, { where: null, limit: 50, $offset: 100 });
  const q = new URL(url).searchParams;
  assert.equal(q.has('$where'), false);
  assert.equal(q.get('$limit'), '50');
  assert.equal(q.get('$offset'), '100');
});

test('socrata: no params yields a bare resource URL', () => {
  assert.equal(socrata.buildUrl(SOC), 'https://data.example.gov/resource/abcd-1234.json');
});

test('socrata: schemaUrl points at the catalog endpoint', () => {
  assert.equal(socrata.schemaUrl(SOC), 'https://data.example.gov/api/views/abcd-1234.json');
});

test('socrata: schema fixture maps to name/type pairs', () => {
  // Mirrors what schema() does with a real catalog response.
  const cols = fixture('socrata-schema.json').columns.map(c => ({
    name: c.fieldName, type: c.dataTypeName,
  }));
  assert.equal(cols.length, 5);
  assert.deepEqual(cols[1], { name: 'date_occ', type: 'calendar_date' });
  assert.ok(cols.some(c => c.name === 'zip_code'), 'zip_code should be discoverable');
});

/* ------------------------------------------------------------------- arcgis */
test('arcgis: buildQueryUrl always requests f=json and encodes quotes as %27', () => {
  const url = arcgis.buildQueryUrl(AGS, { where: "PSA='201'", returnCountOnly: 'true' });
  assert.ok(url.startsWith('https://gis.example.gov/arcgis/rest/services/Crime/MapServer/39/query?f=json'));
  assert.match(url, /where=PSA%3D%27201%27/);
  assert.match(url, /returnCountOnly=true/);
  assert.equal(url.includes("'"), false, 'raw single quotes break some ArcGIS servers');
});

test('arcgis: layer defaults to 0 and a trailing slash on the service is tolerated', () => {
  const url = arcgis.buildQueryUrl({ service: `${AGS.service}/` }, { where: '1=1' });
  assert.match(url, /MapServer\/0\/query\?/);
});

test('arcgis: enc escapes single quotes', () => {
  assert.equal(arcgis.enc("A='B'"), 'A%3D%27B%27');
});

test('arcgis: date-dialect candidates cover DATE, TIMESTAMP and epoch', () => {
  const cands = arcgis.dateDialectCandidates('START_DATE', '2025-07-15');
  assert.deepEqual(cands.map(c => c.dialect), ['DATE', 'TIMESTAMP', 'EPOCH']);
  assert.match(cands[0].where, /START_DATE > DATE '2025-07-15'/);
  assert.match(cands[1].where, /TIMESTAMP '2025-07-15 00:00:00'/);
  assert.match(cands[2].where, /START_DATE > \d{12,}/);
});

test('arcgis: attr() reads attributes case-insensitively', () => {
  // Real servers UPPERCASE outStatisticFieldName: you ask for `newest`, you get
  // `NEWEST`. A case-sensitive read returns undefined and freshness silently
  // fails on a healthy service. Observed live on a MapServer.
  const attrs = fixture('arcgis-maxdate.json').features[0].attributes;
  assert.equal(arcgis.attr(attrs, 'newest'), 1787003220000);
  assert.equal(arcgis.attr(attrs, 'NEWEST'), 1787003220000);
  assert.equal(arcgis.attr(attrs, 'missing'), undefined);
  assert.equal(arcgis.attr(undefined, 'newest'), undefined);
});

test('arcgis: an epoch-ms max converts to an ISO date', () => {
  const raw = arcgis.attr(fixture('arcgis-maxdate.json').features[0].attributes, 'newest');
  assert.equal(new Date(raw).toISOString().slice(0, 10), '2026-08-17');
});

test('arcgis: layer fixture exposes a text date field — the string-date trap', () => {
  const fields = fixture('arcgis-layer.json').fields;
  const collision = fields.find(f => f.name === 'COLLISION_DATE');
  assert.equal(collision.type, 'esriFieldTypeString');
  assert.equal(/text|string/i.test(collision.type), true);
});

test('arcgis: hubSearchUrl uses the sharing API, not the rejected filter[orgid]', () => {
  const url = arcgis.hubSearchUrl('RmCCgQtiZLDCtblq', 'crime');
  assert.match(url, /arcgis\.com\/sharing\/rest\/search/);
  assert.match(url, /orgid%3ARmCCgQtiZLDCtblq/);
  assert.equal(url.includes('filter[orgid]'), false);
});

/* ------------------------------------------- cleaning applied to fixtures */
test('sample rows: padding is detectable and trimming fixes it', () => {
  const rows = fixture('socrata-rows.json');
  const areas = rows.map(r => r.area_name);
  assert.equal(detectPadding(areas).padded, true);
  assert.equal(trimAll(rows[0]).area_name, 'Harbor');
});

test('sample rows: dedupe removes the duplicate a paginated scan would return twice', () => {
  const rows = fixture('socrata-rows.json');
  assert.equal(rows.length, 3);
  assert.equal(dedupeBy(rows, 'incident_id').length, 2);
});

test('sample rows: ISO dates are not flagged as the string-date trap', () => {
  const rows = fixture('socrata-rows.json');
  const dates = rows.map(r => r.date_occ);
  assert.equal(looksLikeStringDate(dates), false);
  assert.equal(toDateISO(dates[0]), '2026-08-14');
});
