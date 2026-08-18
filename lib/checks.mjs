// Reusable assertions for source probes. COPY, DON'T IMPORT — see TOOLKIT.md.
//
// Every check returns { ok, detail } rather than throwing, so a probe can report
// all failures in one pass instead of stopping at the first. `detail` is written
// to be pasted into a report or a registry `traps` cell.
//
// The doctrine these encode: assert MEANING, not status codes. A 200 that
// returns zero rows where rows are expected is a failure, because in a published
// issue it becomes "nothing happened this week" — a lie rather than a gap.

import { toDateISO } from './clean.mjs';

const ok = detail => ({ ok: true, detail });
const bad = detail => ({ ok: false, detail });

/**
 * Row-count floor, taken from a real first run — never guessed.
 * A sudden drop below it means the filter or the field name broke, not that the
 * neighbourhood went quiet.
 */
export function assertRowFloor(n, floor) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return bad(`row count is ${JSON.stringify(n)}, not a number — the query failed or the shape changed`);
  }
  if (n < floor) {
    return bad(`only ${n} rows, floor is ${floor} — the filter or field name is wrong, not the neighbourhood`);
  }
  return ok(`${n} rows (floor ${floor})`);
}

/**
 * Freshness, measured against the DATA's newest record.
 * `maxLagDays` comes from the source's real cadence, not from a round number.
 */
export function assertFreshness(newestISO, maxLagDays, today = new Date()) {
  const iso = toDateISO(newestISO);
  if (!iso) {
    return bad(`newest record date is unreadable (${JSON.stringify(newestISO)}) — if the field is text, max() sorts lexicographically and lies`);
  }
  const days = Math.round((Date.parse(`${todayISO(today)}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86400000);
  if (days > maxLagDays) {
    return bad(`newest record is ${iso}, ${days} days old (max ${maxLagDays}) — the feed may be frozen or retired`);
  }
  return ok(`newest record ${iso}, ${days} days behind (max ${maxLagDays})`);
}

const todayISO = d => new Date(d).toISOString().slice(0, 10);

/**
 * A 200 with an empty body is a failure, not "no data".
 * Some feeds return nothing at all unless a browser User-Agent is sent.
 */
export function assertNonEmptyBody(text) {
  const bytes = typeof text === 'string' ? Buffer.byteLength(text) : 0;
  if (!text || text.trim() === '') {
    return bad('HTTP 200 with an empty body — usually a bot filter; send a browser User-Agent');
  }
  return ok(`${bytes} bytes returned`);
}

/**
 * Does the geography you claim actually appear in the rows?
 * Guards against a filter that "works" while returning another jurisdiction's
 * data — a portal being the wrong jurisdiction is the most common wasted hour.
 */
export function assertGeographyPresent(rows, field, expected) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return bad(`no rows to check for ${field}=${expected} — a 200 with zero rows is a failure, not a quiet week`);
  }
  const want = String(expected).trim();
  const matches = rows.filter(r => String(r?.[field] ?? '').trim() === want);
  if (matches.length === 0) {
    const seen = [...new Set(rows.map(r => String(r?.[field] ?? '').trim()))].slice(0, 5);
    return bad(
      `${field} never equals ${JSON.stringify(want)} in ${rows.length} sampled rows ` +
      `(saw ${JSON.stringify(seen)}) — wrong jurisdiction, wrong field, or a padded value`,
    );
  }
  return ok(`${matches.length}/${rows.length} sampled rows have ${field}=${want}`);
}

/**
 * Assert a known upstream BUG still exists.
 *
 * The most valuable probe shape and the least obvious. Once you work around a
 * quirk — a padded field, a lying timestamp — your workaround becomes the bug
 * the day upstream fixes it. This is the only thing that will tell you.
 *
 * `probeFn` returns the count an equality filter on the *unpadded* value gives.
 * Still 0 → the trap is intact, keep the workaround. Non-zero → upstream fixed
 * it, and your adapter now needs review.
 */
export async function assertPaddingTrapStillExists(probeFn) {
  let n;
  try {
    n = await probeFn();
  } catch (err) {
    return bad(`probe threw: ${err.message}`);
  }
  if (n === 0) {
    return ok('equality filter on the unpadded value still returns 0 — the padding trap is intact, keep the workaround');
  }
  return bad(
    `equality filter on the unpadded value now returns ${n} — UPSTREAM APPEARS FIXED. ` +
    `Your padding workaround may now be the bug; re-verify the adapter.`,
  );
}

/**
 * Assert a semantic assumption still resolves.
 *
 * If your adapter splits rows with a regex over a free-text column (officer- vs
 * public-initiated calls, say), an upstream rename makes the regex match nothing
 * — and the split silently collapses into one misleading total with every gate
 * still green. Liveness probes cannot catch that class.
 */
export function assertClassificationResolves(values, regex, { minMatches = 1 } = {}) {
  const vals = (values ?? []).map(v => String(v ?? '').trim()).filter(Boolean);
  if (vals.length === 0) {
    return bad('no values sampled — cannot confirm the classification still resolves');
  }
  const matched = vals.filter(v => regex.test(v));
  if (matched.length < minMatches) {
    return bad(
      `classification ${regex} matched ${matched.length}/${vals.length} sampled values ` +
      `(need ${minMatches}) — codes were probably renamed; the split will collapse into one ` +
      `misleading total while every gate stays green`,
    );
  }
  return ok(`${matched.length}/${vals.length} sampled values match ${regex}`);
}
