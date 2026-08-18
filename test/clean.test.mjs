import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trimAll, toNumber, toDateISO, emptyToNull, dedupeBy, detectPadding, looksLikeStringDate,
} from '../lib/clean.mjs';

test('trimAll strips padding from string values only', () => {
  const row = { area_name: 'Harbor              ', n: 42, code: '  09  ', nul: null };
  assert.deepEqual(trimAll(row), { area_name: 'Harbor', n: 42, code: '09', nul: null });
});

test('trimAll passes through non-objects untouched', () => {
  assert.equal(trimAll(null), null);
  assert.equal(trimAll('x'), 'x');
});

test('toNumber coerces the string numerics these APIs return', () => {
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber(' 1,004,894 '), 1004894);
  assert.equal(toNumber('$1,250.50'), 1250.5);
  assert.equal(toNumber('-3.5'), -3.5);
  assert.equal(toNumber('1e3'), 1000);
  assert.equal(toNumber(7), 7);
});

test('toNumber refuses non-numerics rather than returning NaN', () => {
  // NaN leaking into a total is how a count silently becomes nonsense.
  for (const v of ['', '  ', 'N/A', 'abc', '12abc', null, undefined, true, {}, NaN, Infinity]) {
    assert.equal(toNumber(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test('toDateISO handles epoch milliseconds (ArcGIS date fields)', () => {
  assert.equal(toDateISO(1787003220000), '2026-08-17');
  assert.equal(toDateISO('1787003220000'), '2026-08-17');
});

test('toDateISO handles ISO and ISO-ish', () => {
  assert.equal(toDateISO('2026-08-14'), '2026-08-14');
  assert.equal(toDateISO('2026-08-14T00:00:00.000'), '2026-08-14');
  assert.equal(toDateISO('2026-08-14 09:30:00'), '2026-08-14');
});

test('toDateISO handles US M/D/YYYY, the string-date form', () => {
  assert.equal(toDateISO('9/7/2019'), '2019-09-07');
  assert.equal(toDateISO('12/31/2023'), '2023-12-31');
  assert.equal(toDateISO('1/1/2020 08:00:00'), '2020-01-01');
});

test('toDateISO rejects the ambiguous and the impossible', () => {
  assert.equal(toDateISO('13/13/2020'), null);   // no such month
  assert.equal(toDateISO('2/30/2020'), null);    // no such day
  assert.equal(toDateISO('2026-02-30'), null);
  assert.equal(toDateISO('not a date'), null);
  assert.equal(toDateISO(''), null);
  assert.equal(toDateISO(null), null);
  assert.equal(toDateISO(1600), null);           // too small to be epoch ms
});

test('emptyToNull collapses blank strings but keeps zero and false', () => {
  assert.equal(emptyToNull(''), null);
  assert.equal(emptyToNull('   '), null);
  assert.equal(emptyToNull(undefined), null);
  assert.equal(emptyToNull(0), 0);
  assert.equal(emptyToNull(false), false);
  assert.equal(emptyToNull('x'), 'x');
});

test('dedupeBy keeps first occurrence, by key name or function', () => {
  const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'a', v: 3 }];
  assert.deepEqual(dedupeBy(rows, 'id'), [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
  assert.deepEqual(dedupeBy(rows, r => r.id), [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
  assert.deepEqual(dedupeBy([], 'id'), []);
});

test('detectPadding finds whitespace padding and reports evidence', () => {
  const res = detectPadding(['Harbor              ', 'Central             ', 'Newton              ']);
  assert.equal(res.padded, true);
  assert.match(res.evidence, /whitespace/);
  assert.match(res.evidence, /width 20/);
});

test('detectPadding finds zero-padded fixed-width codes', () => {
  const res = detectPadding(['09', '01', '12', '05']);
  assert.equal(res.padded, true);
  assert.match(res.evidence, /zero-padded to fixed width 2/);
});

test('detectPadding does not cry wolf on clean values', () => {
  assert.equal(detectPadding(['Harbor', 'Central', 'Newton']).padded, false);
  assert.equal(detectPadding(['1', '2', '30']).padded, false);   // varying width, not padded
  assert.equal(detectPadding([]).padded, false);
  assert.equal(detectPadding([1, 2, 3]).padded, false);          // no strings sampled
});

test('looksLikeStringDate flags M/D/YYYY, the lexicographic-sort trap', () => {
  assert.equal(looksLikeStringDate(['9/7/2019', '12/31/2023', '1/1/2020']), true);
});

test('looksLikeStringDate does NOT flag sortable or real date types', () => {
  assert.equal(looksLikeStringDate(['2026-08-14', '2019-09-07']), false); // ISO sorts fine
  assert.equal(looksLikeStringDate([1787003220000, 1600000000000]), false); // real dates
  assert.equal(looksLikeStringDate([]), false);
  assert.equal(looksLikeStringDate(['not a date', 'x']), false);
});
