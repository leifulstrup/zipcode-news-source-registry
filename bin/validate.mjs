// validate — check every data/*.csv against the schema before a human reviews it.
//
//   node bin/validate.mjs            all state files
//   node bin/validate.mjs data/CA.csv
//
// Why this exists. A maintainer cannot re-verify every source in every pull
// request — that is the whole reason the registry tells consumers to treat rows
// as leads rather than authority. What review CAN do is judgment: is this
// plausible, is the trap real, is the jurisdiction right. Everything mechanical
// should be settled before a human opens the diff, so the human spends attention
// where only a human helps.
//
// It also enforces the one rule that cannot be left to good intentions: no
// contributor identity, ever.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseObjects, COLUMNS, REQUIRED } from '../lib/csv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const VOCAB = {
  scope_type: ['state', 'county', 'place', 'region'],
  category: ['crime', 'calls-for-service', '311', 'permits', 'zoning', 'assessor', 'deeds',
    'courts', 'inspections', 'schools', 'transit', 'parks', 'elections', 'parcels',
    'news', 'civic', 'other'],
  api_type: ['socrata', 'arcgis', 'ckan', 'rss', 'html', 'pdf', 'manual'],
  source_class: ['primary', 'interestedPrimary', 'secondary'],
  status: ['live', 'degraded', 'manual-only', 'dead'],
  update_cadence: ['realtime', 'hourly', 'daily', 'weekly', 'biweekly', 'monthly',
    'quarterly', 'annual', 'irregular', 'unknown', ''],
  data_maturity: ['preliminary', 'final', 'revised', 'mixed', 'unknown', ''],
  quality: ['excellent', 'good', 'fair', 'poor', 'unusable', ''],
};

// Never merge a row carrying a person. These are shapes, not names: an email
// address, a US phone number, a street address, a decimal coordinate pair, or a
// parcel identifier — all of which identify someone, and none of which a fact
// about a public data source needs.
const PII = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'an email address'],
  [/\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/, 'a phone number'],
  [/\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Court|Way)\b/, 'a street address'],
  [/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/, 'a coordinate pair'],
  [/\bAPN\s*:?\s*\d/i, 'a parcel number'],
];

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(join(ROOT, 'data')).filter(f => /^[A-Z]{2}\.csv$/.test(f)).map(f => join('data', f));

let errors = 0, warnings = 0, rowCount = 0;
const seenIds = new Map();

for (const rel of files) {
  const path = join(ROOT, rel);
  let rows;
  try {
    rows = parseObjects(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`::error file=${rel}::unparseable CSV — ${e.message}`);
    errors++; continue;
  }

  const stateFromName = basename(rel, '.csv');
  const sortKey = r => `${r.county_fips}|${r.place_fips}|${r.category}|${r.source_id}`;
  let prevKey = '';

  rows.forEach((r, i) => {
    rowCount++;
    const where = `${rel}:${i + 2}`;                 // +2: header plus 1-indexing
    const fail = m => { console.error(`::error file=${rel},line=${i + 2}::${m}`); errors++; };
    const warn = m => { console.warn(`::warning file=${rel},line=${i + 2}::${m}`); warnings++; };

    for (const col of REQUIRED) {
      if (!String(r[col] ?? '').trim()) fail(`${where}: required column "${col}" is empty.`);
    }
    for (const [col, allowed] of Object.entries(VOCAB)) {
      const v = String(r[col] ?? '');
      if (v && !allowed.includes(v)) {
        fail(`${where}: ${col}="${v}" is not one of: ${allowed.filter(Boolean).join(', ')}. See SCHEMA.md.`);
      }
    }
    if (r.state !== stateFromName) fail(`${where}: state="${r.state}" but the file is ${rel}.`);
    if (r.scope_type !== 'state' && !/^\d{5}$/.test(r.county_fips || ''))
      fail(`${where}: county_fips must be 5 digits, zero-padded (got "${r.county_fips}").`);
    if (r.scope_type === 'place' && !/^\d{7}$/.test(r.place_fips || ''))
      fail(`${where}: scope_type=place requires a 7-digit place_fips (got "${r.place_fips}").`);
    if (!/^https?:\/\//.test(r.url || '')) fail(`${where}: url must be http(s).`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.last_verified || ''))
      fail(`${where}: last_verified must be YYYY-MM-DD — the date you actually fetched it.`);
    if (r.lag_days && !/^\d+$/.test(r.lag_days))
      fail(`${where}: lag_days must be a whole number of days (got "${r.lag_days}").`);

    // Identity: the rule that cannot be left to good intentions.
    const haystack = COLUMNS.map(c => r[c] ?? '').join(' | ');
    for (const [re, what] of PII) {
      if (re.test(haystack)) {
        fail(`${where}: contains ${what}. Rows are public-record facts about public data sources — ` +
             `never contributor or resident identity. Remove it; do not obfuscate it.`);
      }
    }

    // Duplicate ids across all files.
    if (seenIds.has(r.source_id)) fail(`${where}: duplicate source_id "${r.source_id}" (also ${seenIds.get(r.source_id)}).`);
    else seenIds.set(r.source_id, where);

    // Sorted, so diffs stay small and contributors in different counties never collide.
    const key = sortKey(r);
    if (prevKey && key < prevKey)
      warn(`${where}: out of order. Sort by (county_fips, place_fips, category, source_id) to keep diffs clean.`);
    prevKey = key;

    // Judgment prompts — warnings, because a human decides.
    const age = (Date.now() - Date.parse(`${r.last_verified}T12:00:00Z`)) / 86400000;
    if (age > 180) warn(`${where}: last_verified is ${Math.round(age)} days old. Re-verify before adding, or mark status honestly.`);
    if (age < -1) fail(`${where}: last_verified is in the future.`);
    if (!r.traps && !r.insights)
      warn(`${where}: no traps and no insights. The URL is the least valuable column — what did you learn that another publisher could not look up?`);
    if (r.status === 'dead' && !r.traps)
      warn(`${where}: marked dead with no explanation. Say what happened; a dead row with a reason still saves the next person.`);
  });
}

console.log(`\nvalidate: ${rowCount} row(s) across ${files.length} file(s) — ${errors} error(s), ${warnings} warning(s)`);
if (errors) {
  console.error('\nErrors must be fixed before merge. Warnings are for the reviewer and the contributor to weigh.');
  process.exit(1);
}
console.log('Schema, vocabularies, identity rules and uniqueness all pass. A human still judges whether the source is real.');
