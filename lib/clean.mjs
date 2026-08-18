// Cleaning helpers for government data output. COPY, DON'T IMPORT — see TOOLKIT.md.
//
// Pure functions, no I/O, fully unit tested. Each one exists because raw
// municipal data reliably breaks something downstream if you skip it.

/**
 * Trim every string value in a row.
 *
 * THE PADDING TRAP: government feeds pad string columns to fixed width
 * (`'Harbor              '`) and zero-pad codes (`'05'` for 5). An equality
 * filter against the unpadded value then returns 0 rows with HTTP 200 —
 * indistinguishable from a quiet week. Trim on the way in, and prefer LIKE or a
 * numeric id in the query itself.
 */
export function trimAll(row) {
  if (row === null || typeof row !== 'object') return row;
  const out = Array.isArray(row) ? [] : {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/**
 * Coerce to a number, or null. Socrata returns counts and coordinates as
 * STRINGS; `"12" + 1` is `"121"`, which is how a total becomes nonsense.
 * Handles thousands separators and stray currency symbols; refuses anything
 * that is not cleanly numeric rather than guessing (NaN is never returned).
 */
export function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  const s = String(v).trim().replace(/[$,\s]/g, '');
  if (s === '') return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise a date to ISO `YYYY-MM-DD`, or null.
 *
 * Handles the three forms these APIs actually emit:
 *   - epoch milliseconds (ArcGIS date fields), as number or numeric string
 *   - ISO / ISO-ish (`2026-08-14`, `2026-08-14T00:00:00.000`)
 *   - US `M/D/YYYY` (the string-date fields that sort lexicographically)
 *
 * Returns null rather than guessing on anything ambiguous. Deliberately does NOT
 * accept D/M/YYYY: there is no way to tell 3/4/2026 apart, and a silent
 * misreading of a date is worse than a gap.
 */
export function toDateISO(v) {
  if (v === null || v === undefined || v === '') return null;

  // epoch milliseconds (ArcGIS). Seconds are ambiguous with year-like ints, so
  // only ms-magnitude values are accepted.
  if (typeof v === 'number' || /^\d{10,}$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n) < 1e11) return null; // too small to be ms in a plausible era
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const s = String(v).trim();

  // ISO or ISO-ish
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/);
  if (iso) {
    const [, y, m, d] = iso;
    return isRealDate(+y, +m, +d) ? `${y}-${m}-${d}` : null;
  }

  // US M/D/YYYY or MM/DD/YYYY (optionally with a time)
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T ,]|$)/);
  if (us) {
    const [, m, d, y] = us;
    if (!isRealDate(+y, +m, +d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return null;
}

function isRealDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Empty string → null. Socrata omits null fields from JSON rows entirely, so a
 * missing key is not an error; an empty string, however, is a value that will
 * quietly join and group as if it meant something.
 */
export function emptyToNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
}

/**
 * De-duplicate by a key function, keeping first occurrence.
 * Paginated scans overlap when rows are inserted mid-scan, so the same record
 * arrives twice and inflates a count. De-dupe on the dataset's own record id.
 */
export function dedupeBy(rows, key) {
  const fn = typeof key === 'function' ? key : row => row?.[key];
  const seen = new Set();
  const out = [];
  for (const row of rows ?? []) {
    const k = fn(row);
    const id = k === null || k === undefined ? Symbol('nullkey') : String(k);
    if (typeof id === 'string') {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(row);
  }
  return out;
}

/**
 * Does this column look padded?
 *
 * Returns { padded, evidence }. Evidence is what to put in a registry `traps`
 * cell. Detects both leading/trailing whitespace padding and fixed-width
 * zero-padding of numeric-looking codes.
 */
export function detectPadding(values) {
  const strings = (values ?? []).filter(v => typeof v === 'string');
  if (strings.length === 0) return { padded: false, evidence: 'no string values sampled' };

  const whitespacePadded = strings.filter(s => s !== s.trim());
  if (whitespacePadded.length > 0) {
    const sample = whitespacePadded[0];
    const widths = new Set(whitespacePadded.map(s => s.length));
    const fixed = widths.size === 1 ? ` all padded to width ${[...widths][0]};` : '';
    return {
      padded: true,
      evidence:
        `${whitespacePadded.length}/${strings.length} sampled values carry surrounding whitespace` +
        `${fixed} e.g. ${JSON.stringify(sample)} — an equality filter on the trimmed value ` +
        `returns 0 rows with HTTP 200`,
    };
  }

  // Zero-padded numeric codes: '05', '007' — same trap, different disguise.
  const numericish = strings.filter(s => /^\d+$/.test(s));
  const zeroPadded = numericish.filter(s => s.length > 1 && s.startsWith('0'));
  if (zeroPadded.length > 0 && numericish.length > 0) {
    const widths = new Set(numericish.map(s => s.length));
    if (widths.size === 1) {
      return {
        padded: true,
        evidence:
          `numeric codes are zero-padded to fixed width ${[...widths][0]} ` +
          `(e.g. ${JSON.stringify(zeroPadded[0])}) — filtering on the unpadded number returns 0 rows`,
      };
    }
  }

  return { padded: false, evidence: 'sampled values are unpadded' };
}

/**
 * Is this date field stored as a STRING rather than a date type?
 *
 * The trap: a layer whose catalog says it was modified yesterday, whose
 * `collision_date` is text in `M/D/YYYY`, sorts "9/7/2019" to the top as the
 * "newest" record — while the data actually stops in 2023. Any max()/ORDER BY
 * over such a field is lexicographic and lies.
 *
 * Pass a sample of raw values. Returns true when they parse as dates but are
 * not in a lexicographically-sortable form.
 */
export function looksLikeStringDate(sample) {
  const vals = (Array.isArray(sample) ? sample : [sample]).filter(
    v => v !== null && v !== undefined && v !== '',
  );
  if (vals.length === 0) return false;

  // Numbers (epoch ms) are real date types, not string dates.
  if (vals.every(v => typeof v === 'number')) return false;

  const strs = vals.filter(v => typeof v === 'string').map(s => s.trim());
  if (strs.length === 0) return false;

  // ISO strings sort correctly, so they are not the trap even when stored as text.
  const allIso = strs.every(s => /^\d{4}-\d{2}-\d{2}/.test(s));
  if (allIso) return false;

  // M/D/YYYY (or similar non-sortable) that still parses as a date IS the trap.
  const nonSortableDates = strs.filter(s => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(s) && toDateISO(s));
  return nonSortableDates.length > 0;
}
