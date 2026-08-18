// RFC 4180 CSV + the registry schema. COPY, DON'T IMPORT — see TOOLKIT.md.
//
// The schema lives here in executable form so `diagnose` can emit a draft row
// that is guaranteed to have the right columns in the right order. SCHEMA.md is
// the human definition; if the two ever disagree, SCHEMA.md wins and this file
// is the bug.

/** Column order is fixed. New columns are APPENDED, never inserted. */
export const COLUMNS = [
  'source_id', 'scope_type', 'state', 'county_fips', 'place_fips', 'jurisdiction',
  'category', 'name', 'url', 'platform', 'api_type', 'geo_filter', 'source_class',
  'status', 'update_cadence', 'lag_days', 'data_maturity', 'history_start',
  'retention', 'quality', 'last_verified', 'kit_version', 'traps', 'insights', 'notes',
];

/** Required to be a valid row: through `status`, plus verification provenance. */
export const REQUIRED = [
  'source_id', 'scope_type', 'state', 'jurisdiction', 'category', 'name', 'url',
  'platform', 'api_type', 'geo_filter', 'source_class', 'status',
  'last_verified', 'kit_version',
];

/** Quote only when required: comma, quote, CR or LF. */
export function serializeValue(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One object → one CSV line, in COLUMNS order. */
export function serializeRow(obj, columns = COLUMNS) {
  return columns.map(c => serializeValue(obj[c])).join(',');
}

/** Rows → a full CSV document with a header. */
export function serialize(rows, columns = COLUMNS) {
  return [columns.join(','), ...rows.map(r => serializeRow(r, columns))].join('\n') + '\n';
}

/**
 * RFC 4180 parser. Handles quoted fields containing commas, newlines and
 * escaped `""`. Returns an array of arrays; blank trailing line ignored.
 */
export function parse(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse into objects keyed by the header row. */
export function parseObjects(text) {
  const rows = parse(text).filter(r => r.length > 1);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** Which required columns are missing/blank? Returns an array of names. */
export function missingRequired(obj) {
  return REQUIRED.filter(c => {
    const v = obj[c];
    return v === null || v === undefined || String(v).trim() === '';
  });
}
