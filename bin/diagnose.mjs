#!/usr/bin/env node
// diagnose — point it at a candidate data source and find out what you are
// dealing with, before you spend an afternoon on it.
//
//   node bin/diagnose.mjs <url> [--zip 90706] [--json]
//
// THIS IS A STANDALONE TOOL, not part of anyone's publishing pipeline. You run
// it while evaluating a source; nothing fetches or executes it on a schedule.
// See TOOLKIT.md.
//
// It answers the questions that cost the most time to answer by hand:
//   what platform is this · is it alive · what are the fields and their TYPES
//   how current is the DATA (not the metadata) · does it retain history
//   are its string fields padded · can it be filtered to a ZIP
//
// and finishes by printing a draft registry row with everything it could
// establish filled in. Blank means unknown — a human verifies before submitting.
//
// Exit codes: 0 = a diagnosis was produced (even a damning one — the diagnosis
// IS the output). 2 = usage error.

import { fetchText, fetchJson, HttpError } from '../lib/http.mjs';
import * as socrata from '../lib/socrata.mjs';
import * as arcgis from '../lib/arcgis.mjs';
import { detectPadding, looksLikeStringDate, toDateISO } from '../lib/clean.mjs';
import { COLUMNS, serializeRow, missingRequired } from '../lib/csv.mjs';

const USAGE = `diagnose — inspect a candidate data source and draft a registry row

  node bin/diagnose.mjs <url> [options]

Arguments
  <url>            A Socrata dataset URL, an ArcGIS FeatureServer/MapServer
                   layer URL, or a portal URL. Examples:
                     https://data.lacity.org/resource/2nrs-mtv8.json
                     https://services1.arcgis.com/<org>/arcgis/rest/services/<svc>/FeatureServer/0

Options
  --zip <zip>      Test whether the source can be filtered to this ZIP
  --json           Emit the full diagnosis as JSON instead of a report
  -h, --help       This message

What it checks
  platform · liveness · field names and TYPES · PII-shaped fields
  freshness from the DATA (never the portal's updatedAt) · reporting lag
  retention (rolling vs full — decides whether year-over-year is even possible)
  padded string fields (the equality-filter-returns-zero trap)
  geography: is there a ZIP field, or which technique will be needed

Nothing here is authoritative. It produces a lead for a human to verify.`;

/* ------------------------------------------------------------------ arguments */
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(USAGE);
  process.exit(argv.length === 0 ? 2 : 0);
}

const asJson = argv.includes('--json');
const zipIdx = argv.indexOf('--zip');
const zip = zipIdx >= 0 ? argv[zipIdx + 1] : null;
if (zipIdx >= 0 && !zip) {
  console.error('diagnose: --zip needs a value\n');
  console.error(USAGE);
  process.exit(2);
}
const target = argv.find(a => /^https?:\/\//i.test(a));
if (!target) {
  console.error('diagnose: give me a source URL (http/https)\n');
  console.error(USAGE);
  process.exit(2);
}

/* ------------------------------------------------------------------- reporting */
const D = {
  url: target,
  zip: zip ?? null,
  checkedAt: new Date().toISOString().slice(0, 10),
  platform: null,
  platformEvidence: null,
  liveness: {},
  fields: [],
  warnings: [],
  notes: [],
  freshness: {},
  retention: {},
  padding: {},
  geography: {},
  draftRow: null,
};

const say = (...a) => { if (!asJson) console.log(...a); };
const head = t => say(`\n${t}\n${'─'.repeat(Math.min(t.length, 72))}`);
const warn = t => { D.warnings.push(t); say(`  ⚠ ${t}`); };
const note = t => { D.notes.push(t); say(`  · ${t}`); };

/* ------------------------------------------------- 1. platform identification */
function identifyPlatform(url) {
  const u = new URL(url);
  const p = u.pathname;

  if (/\/rest\/services\/.+\/(FeatureServer|MapServer)(\/\d+)?/i.test(p)) {
    return { platform: /FeatureServer/i.test(p) ? 'arcgis-server' : 'arcgis-server',
             evidence: 'URL path contains /rest/services/.../FeatureServer|MapServer' };
  }
  if (/\/resource\/[a-z0-9]{4}-[a-z0-9]{4}(\.json)?$/i.test(p)) {
    return { platform: 'socrata', evidence: 'URL path is /resource/<four-four>.json' };
  }
  if (/\/api\/views\/[a-z0-9]{4}-[a-z0-9]{4}/i.test(p)) {
    return { platform: 'socrata', evidence: 'URL path is the Socrata catalog endpoint /api/views/<four-four>' };
  }
  if (/opendata\.arcgis\.com$/i.test(u.hostname) || /^hub-/i.test(u.hostname)) {
    return { platform: 'arcgis-hub', evidence: `hostname ${u.hostname} is an ArcGIS Hub domain` };
  }
  if (/\/api\/3\/action\//i.test(p)) {
    return { platform: 'ckan', evidence: 'URL path is the CKAN action API' };
  }
  return { platform: null, evidence: null };
}

/** Portal-level probing when the URL is not a dataset endpoint. */
async function sniffPortal(url) {
  try {
    const res = await fetchText(url, { timeoutMs: 15000 });
    const body = res.text.slice(0, 200000);
    if (/Socrata|tyler(data|-data)|dataset-landing-page/i.test(body)) {
      return { platform: 'socrata', evidence: 'portal HTML mentions Socrata/Tyler Data & Insights' };
    }
    const orgId = body.match(/"orgId"\s*:\s*"([A-Za-z0-9]+)"/)?.[1]
      ?? body.match(/orgId["']?\s*[:=]\s*["']([A-Za-z0-9]+)["']/)?.[1];
    if (orgId || /arcgis/i.test(body)) {
      return {
        platform: 'arcgis-hub',
        evidence: orgId
          ? `portal HTML exposes orgId ${orgId} — search via arcgis.com/sharing/rest/search?q=orgid:${orgId}`
          : 'portal HTML mentions ArcGIS',
        orgId,
      };
    }
    if (/ckan/i.test(body)) return { platform: 'ckan', evidence: 'portal HTML mentions CKAN' };
    return { platform: null, evidence: `fetched ${res.bytes} bytes, no platform marker found` };
  } catch (err) {
    return { platform: null, evidence: `portal fetch failed: ${err.message}` };
  }
}

/* --------------------------------------------------------- source descriptors */
function socrataSource(url) {
  const u = new URL(url);
  const id = u.pathname.match(/([a-z0-9]{4}-[a-z0-9]{4})/i)?.[1];
  return id ? { host: u.hostname, dataset: id } : null;
}

function arcgisSource(url) {
  const m = url.match(/^(.*\/rest\/services\/.+?\/(?:FeatureServer|MapServer))(?:\/(\d+))?/i);
  if (!m) return null;
  return { service: m[1], layer: m[2] !== undefined ? Number(m[2]) : 0 };
}

/* -------------------------------------------------------------- PII detection */
const PII = /(owner|firstname|lastname|full_?name|applicant|resident|address|addr|street|house|latitude|longitude|^lat$|^lon$|^lng$|^x$|^y$|parcel|\bapn\b|ssn|phone|email|dob|birth)/i;

/* ------------------------------------------------------------- date detection */
const DATEISH = /(date|dttm|datetime|occurred|reported|issued|filed|created|received|time)/i;

const daysBetween = (aISO, bISO) =>
  Math.round((Date.parse(`${bISO}T12:00:00Z`) - Date.parse(`${aISO}T12:00:00Z`)) / 86400000);
const daysAgoISO = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/* ================================================================= diagnose == */
say(`diagnose — ${target}`);
say(`checked ${D.checkedAt}${zip ? ` · target ZIP ${zip}` : ''}`);

head('1. Platform');
let ident = identifyPlatform(target);
if (!ident.platform) {
  note('URL shape did not identify a platform — sniffing the page');
  ident = await sniffPortal(target);
}
D.platform = ident.platform;
D.platformEvidence = ident.evidence;
if (ident.orgId) D.orgId = ident.orgId;
say(`  platform: ${D.platform ?? 'unknown'}`);
say(`  evidence: ${D.platformEvidence ?? 'none'}`);
if (D.platform === 'arcgis-hub' && !arcgisSource(target)) {
  note('This is a Hub PORTAL, not a dataset. Find a layer, then re-run against its FeatureServer URL.');
  note("Hub v3's filter[orgid] is rejected as an invalid parameter key — use the sharing search with q=orgid:<id>.");
}

/* ------------------------------------------------------------- 2. liveness */
head('2. Liveness');
try {
  const res = await fetchText(target, { timeoutMs: 20000 });
  D.liveness = { status: res.status, ms: res.ms, bytes: res.bytes, ok: res.ok };
  say(`  HTTP ${res.status} · ${res.ms}ms · ${res.bytes} bytes`);

  if (res.status === 200 && res.text.trim() === '') {
    warn('HTTP 200 with an EMPTY BODY — a bot filter, not "no data". Send a browser User-Agent.');
    D.liveness.emptyBody = true;
  }
  if (res.status === 403) {
    warn('403 after a retry — alive but bot-blocked. This is `manual-only`, NOT `dead`.');
    D.liveness.manualOnly = true;
  }
  if (res.status >= 500) warn(`server error ${res.status} — retry later before judging it dead`);
} catch (err) {
  D.liveness = { error: err.message };
  warn(`could not fetch: ${err.message}`);
}

/* ---------------------------------------------------- 3. fields and types */
head('3. Fields and types');
let src = null;
let kind = null;

if (D.platform === 'socrata') {
  src = socrataSource(target);
  kind = 'socrata';
} else if (D.platform === 'arcgis-server' || arcgisSource(target)) {
  src = arcgisSource(target);
  kind = 'arcgis';
  D.platform = D.platform ?? 'arcgis-server';
}

let dateField = null;
let dateFieldIsString = false;

if (!src) {
  note('no dataset endpoint to introspect — field-level checks skipped');
} else {
  try {
    D.fields = kind === 'socrata' ? await socrata.schema(src) : await arcgis.fields(src);
    say(`  ${D.fields.length} fields`);
    for (const f of D.fields.slice(0, 40)) say(`    ${f.name.padEnd(28)} ${f.type}`);
    if (D.fields.length > 40) say(`    … and ${D.fields.length - 40} more`);

    const pii = D.fields.filter(f => PII.test(f.name));
    if (pii.length) {
      warn(`PII-shaped fields present: ${pii.map(f => f.name).join(', ')}`);
      warn('NEVER fetch these. Omission beats scrubbing — exclude them from the query itself.');
      D.piiFields = pii.map(f => f.name);
    }

    // Pick a date field, preferring a real date TYPE.
    const dateCandidates = D.fields.filter(f => DATEISH.test(f.name));
    const realDate = dateCandidates.find(f => /date|timestamp/i.test(f.type));
    dateField = (realDate ?? dateCandidates[0])?.name ?? null;

    if (dateField) {
      const chosen = D.fields.find(f => f.name === dateField);
      say(`  date field: ${dateField} (${chosen?.type})`);
      const isText = /text|string/i.test(chosen?.type ?? '');
      if (isText) {
        dateFieldIsString = true;
        warn(`${dateField} is stored as TEXT — max()/ORDER BY over it sorts LEXICOGRAPHICALLY.`);
        warn('"9/7/2019" then reads as the newest row in a dataset that runs to 2023. Derive freshness from a numeric year field instead.');
      }
    } else {
      note('no obvious date field — freshness and retention cannot be measured automatically');
    }
  } catch (err) {
    warn(`schema fetch failed: ${err.message}`);
  }
}

/* ------------------------------------------------------------ 4. freshness */
head('4. Freshness (from the DATA, never the portal metadata)');
if (src && dateField) {
  try {
    const newestRaw = kind === 'socrata'
      ? await socrata.maxDate(src, dateField)
      : await arcgis.maxDate(src, dateField);
    const newestISO = toDateISO(newestRaw);
    D.freshness = { field: dateField, raw: newestRaw, dataThrough: newestISO };

    if (newestISO) {
      const lag = daysBetween(newestISO, D.checkedAt);
      D.freshness.lagDays = lag;
      say(`  dataThrough: ${newestISO}  (lag_days: ${lag})`);
      if (lag > 0) {
        note(`Anchor every trailing window to ${newestISO}, NOT to today. A window anchored to today holds fewer days of data than the one it is compared against and manufactures a false decline.`);
      }
      if (lag > 30) warn(`${lag} days behind — verify the feed is still maintained`);
    } else {
      warn(`max(${dateField}) returned ${JSON.stringify(newestRaw)}, which is not a readable date`);
      if (dateFieldIsString) warn('This is the string-date trap: the value is the lexicographic maximum, not the newest record.');
    }

    // The lying-updatedAt cross-check.
    if (kind === 'socrata') {
      try {
        const { json } = await fetchJson(socrata.schemaUrl(src));
        const meta = json.rowsUpdatedAt ? new Date(json.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null;
        if (meta) {
          D.freshness.portalSays = meta;
          say(`  portal metadata says: ${meta}`);
          if (newestISO && daysBetween(newestISO, meta) > 30) {
            warn(`PORTAL METADATA DISAGREES WITH THE DATA: metadata ${meta} vs newest record ${newestISO}.`);
            warn('The catalog timestamp reflects file touches, not new rows. Trust the data.');
          }
        }
      } catch { /* metadata is a bonus, not a requirement */ }
    }
  } catch (err) {
    warn(`freshness probe failed: ${err.message}`);
  }
} else {
  note('skipped — no dataset endpoint or no date field');
}

/* ------------------------------------------------------------ 5. retention */
head('5. Retention (decides whether year-over-year is even possible)');
if (src && dateField && !dateFieldIsString) {
  try {
    const cutoff = daysAgoISO(400);
    let old = null;
    let total = null;

    if (kind === 'socrata') {
      total = await socrata.count(src);
      old = await socrata.count(src, `${dateField} < '${cutoff}T00:00:00.000'`);
    } else {
      total = await arcgis.count(src);
      const dialect = await arcgis.probeDateDialect(src, dateField, cutoff);
      D.retention.dateDialect = dialect.dialect;
      if (dialect.dialect) {
        say(`  date-literal dialect accepted by this service: ${dialect.dialect}`);
        const cand = arcgis.dateDialectCandidates(dateField, cutoff)
          .find(c => c.dialect === dialect.dialect);
        old = await arcgis.count(src, `${cand.where.replace('>', '<')}`);
      } else {
        warn('no date-literal dialect worked — retention could not be measured');
      }
    }

    if (old !== null && total !== null) {
      D.retention = { ...D.retention, rowsOlderThan400Days: old, totalRows: total };
      say(`  rows older than 400 days: ${old} of ${total} total`);
      const rolling = old < 30;
      D.retention.kind = rolling ? 'rolling' : 'full';
      if (rolling) {
        warn('ROLLING WINDOW — this source does NOT retain last year.');
        warn('A year-over-year query against it returns only the late-filed stragglers still inside the window.');
        warn('A real case returned 16 against 1,493 and printed as a five-figure percentage increase.');
        warn('Year-over-year is UNAVAILABLE here: say so rather than computing it.');
      } else {
        say('  retention: full — a year-over-year comparison is available');
      }
    }
  } catch (err) {
    warn(`retention probe failed: ${err.message}`);
  }
} else {
  note(dateFieldIsString ? 'skipped — the date field is text, so date filters are unreliable' : 'skipped — no dataset endpoint or no date field');
}

/* -------------------------------------------------------------- 6. padding */
head('6. Padded string fields (the equality-filter-returns-zero trap)');
if (src) {
  try {
    const sampleRows = kind === 'socrata'
      ? await socrata.rows(src, { limit: 50 })
      : await arcgis.rows(src, { limit: 50 });

    if (sampleRows.length === 0) {
      warn('no sample rows returned — a 200 with zero rows is a failure, not a quiet week');
    } else {
      const stringFields = D.fields.filter(f => /text|string/i.test(f.type)).map(f => f.name);
      const checked = [];
      for (const name of stringFields.slice(0, 25)) {
        const values = sampleRows.map(r => r?.[name]).filter(v => typeof v === 'string');
        if (values.length < 3) continue;
        const res = detectPadding(values);
        if (res.padded) {
          warn(`${name}: ${res.evidence}`);
          checked.push({ field: name, ...res });
        }
        if (DATEISH.test(name) && looksLikeStringDate(values)) {
          warn(`${name}: values look like M/D/YYYY strings — any max()/ORDER BY over this field lies`);
        }
      }
      D.padding = { sampled: sampleRows.length, paddedFields: checked };
      if (checked.length === 0) say(`  no padding detected in ${sampleRows.length} sampled rows`);
      else warn('Prefer LIKE or a numeric id over equality on these fields, and cross-check against an unfiltered group-by.');
    }
  } catch (err) {
    warn(`sampling failed: ${err.message}`);
  }
} else {
  note('skipped — no dataset endpoint');
}

/* ------------------------------------------------------------- 7. geography */
head('7. Geography');
if (!src) {
  note('skipped — no dataset endpoint');
} else {
  const names = D.fields.map(f => f.name);
  const zipField = names.find(n => /^zip(_?code)?$/i.test(n)) ?? names.find(n => /zip/i.test(n));
  const cityField = names.find(n => /^(city|municipality|place|jurisdiction|community)$/i.test(n));
  const districtField = names.find(n => /(district|beat|precinct|reporting_area|rpt_dist|psa|division|area)/i.test(n));
  const geomField = names.find(n => /(latitude|longitude|^x$|^y$|shape|geom|point)/i.test(n));

  if (zipField) {
    D.geography.geoFilter = zipField;
    say(`  a ZIP field exists: ${zipField}`);
    if (zip) {
      try {
        const n = kind === 'socrata'
          ? await socrata.count(src, `${zipField}='${zip}'`)
          : await arcgis.count(src, `${zipField}='${zip}'`);
        D.geography.zipRowCount = n;
        say(`  rows for ZIP ${zip}: ${n}`);
        if (n === 0) {
          warn(`zero rows for ${zip} — either the wrong jurisdiction, or the field is padded, or the ZIP is genuinely absent.`);
          warn('Check row VOLUME against an unfiltered group-by before concluding coverage.');
        } else if (n > 0) {
          note('Confirm this volume is plausible for the whole ZIP. One plausible row is not coverage.');
        }
      } catch (err) {
        warn(`ZIP filter test failed: ${err.message}`);
      }
    }
  } else if (cityField) {
    D.geography.geoFilter = 'city-name';
    say(`  no ZIP field; a city/place field exists: ${cityField}`);
    warn('Filtering by city name is not the same as filtering by ZIP — a ZIP can cross municipalities, and rows with a null city are silently dropped.');
  } else if (districtField) {
    D.geography.geoFilter = 'district-crosswalk';
    say(`  no ZIP field; a district field exists: ${districtField}`);
    note('You will need a one-time crosswalk of which districts intersect your ZIP, then filter by that ID list.');
  } else if (geomField) {
    D.geography.geoFilter = 'point-in-polygon';
    say(`  no ZIP or district field; coordinates present (${geomField})`);
    note('Point-in-polygon against the ZIP\'s Census ZCTA boundary. Never bridge with a coordinate you then publish.');
  } else {
    D.geography.geoFilter = 'none';
    warn('no usable geography field found — this source may not be filterable to a ZIP at all');
  }
}

/* ------------------------------------------------------------ 8. draft row */
head('8. Draft registry row');

const draft = Object.fromEntries(COLUMNS.map(c => [c, '']));
Object.assign(draft, {
  url: target,
  platform: D.platform ?? '',
  api_type: kind === 'socrata' ? 'socrata' : kind === 'arcgis' ? 'arcgis' : (D.platform === 'ckan' ? 'ckan' : ''),
  geo_filter: D.geography.geoFilter ?? '',
  status: D.liveness.manualOnly ? 'manual-only'
    : D.liveness.error ? 'dead'
    : D.liveness.emptyBody ? 'degraded'
    : D.liveness.status === 200 ? 'live' : '',
  lag_days: D.freshness.lagDays ?? '',
  retention: D.retention.kind === 'rolling' ? '12-months' : D.retention.kind === 'full' ? 'full' : '',
  last_verified: D.checkedAt,
  kit_version: 'diagnose',
});

const traps = [];
if (D.padding?.paddedFields?.length) {
  traps.push(...D.padding.paddedFields.map(f => `${f.field} is padded — equality filters return 0 rows with HTTP 200; use LIKE or a numeric id`));
}
if (dateFieldIsString) traps.push(`${dateField} is stored as text — max()/ORDER BY sorts lexicographically and reports the wrong newest record`);
if (D.retention.kind === 'rolling') traps.push('rolling retention — year-over-year is UNAVAILABLE; a naive prior-year query returns only late-filed stragglers');
if (D.freshness.lagDays > 0) traps.push(`reports ~${D.freshness.lagDays} days behind — anchor trailing windows to max(${dateField}), never to the issue date`);
if (D.piiFields?.length) traps.push(`exposes PII-shaped fields (${D.piiFields.join(', ')}) — never fetch them`);
if (D.liveness.manualOnly) traps.push('403s to non-browser clients — alive but manual-only');
draft.traps = traps.join('; ');

D.draftRow = draft;

if (!asJson) {
  say('');
  say(COLUMNS.join(','));
  say(serializeRow(draft));
  const missing = missingRequired(draft);
  say('');
  say(`  Blank means UNKNOWN, never a default. Still required before submitting:`);
  say(`    ${missing.join(', ')}`);
  say('  A human must verify jurisdiction, category and class — diagnose cannot');
  say('  know which government publishes this or what it is for.');
}

/* ------------------------------------------------------------------ summary */
if (asJson) {
  console.log(JSON.stringify(D, null, 2));
} else {
  head('Summary');
  say(`  platform ${D.platform ?? 'unknown'} · status ${draft.status || 'unknown'} · ` +
      `${D.warnings.length} warning(s)`);
  say('  This is a lead, not a finding. Verify before it enters a publication.');
  say('');
}

process.exit(0);
