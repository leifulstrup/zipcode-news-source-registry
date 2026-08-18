import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRowFloor, assertFreshness, assertNonEmptyBody,
  assertGeographyPresent, assertPaddingTrapStillExists, assertClassificationResolves,
} from '../lib/checks.mjs';

/* ---------------------------------------------------------------- row floor */
test('assertRowFloor passes at or above the floor', () => {
  assert.equal(assertRowFloor(150, 100).ok, true);
  assert.equal(assertRowFloor(100, 100).ok, true);
});

test('assertRowFloor fails below the floor, blaming the filter not the neighbourhood', () => {
  const r = assertRowFloor(12, 100);
  assert.equal(r.ok, false);
  assert.match(r.detail, /filter or field name/);
});

test('assertRowFloor fails on a non-number (the query failed)', () => {
  assert.equal(assertRowFloor(null, 10).ok, false);
  assert.equal(assertRowFloor(undefined, 10).ok, false);
  assert.equal(assertRowFloor(NaN, 10).ok, false);
});

/* ---------------------------------------------------------------- freshness */
const TODAY = new Date('2026-08-18T00:00:00Z');

test('assertFreshness passes inside the allowed lag', () => {
  const r = assertFreshness('2026-08-17', 7, TODAY);
  assert.equal(r.ok, true);
  assert.match(r.detail, /1 days behind/);
});

test('assertFreshness fails when the feed is frozen', () => {
  const r = assertFreshness('2025-03-28', 30, TODAY);
  assert.equal(r.ok, false);
  assert.match(r.detail, /days old/);
});

test('assertFreshness accepts epoch ms and M/D/YYYY inputs', () => {
  assert.equal(assertFreshness(1787003220000, 7, TODAY).ok, true);   // 2026-08-17
  assert.equal(assertFreshness('8/17/2026', 7, TODAY).ok, true);
});

test('assertFreshness fails loudly on an unreadable date, naming the string-date trap', () => {
  const r = assertFreshness('whenever', 7, TODAY);
  assert.equal(r.ok, false);
  assert.match(r.detail, /lexicographically/);
});

/* --------------------------------------------------------------- empty body */
test('assertNonEmptyBody rejects a 200 with nothing in it', () => {
  for (const body of ['', '   ', null, undefined]) {
    const r = assertNonEmptyBody(body);
    assert.equal(r.ok, false);
    assert.match(r.detail, /User-Agent/);
  }
});

test('assertNonEmptyBody passes real content and reports the byte count', () => {
  const r = assertNonEmptyBody('[{"a":1}]');
  assert.equal(r.ok, true);
  assert.match(r.detail, /9 bytes/);
});

/* ---------------------------------------------------------------- geography */
test('assertGeographyPresent passes when the expected value is actually present', () => {
  const rows = [{ zip: '90706' }, { zip: '90706' }, { zip: '90201' }];
  const r = assertGeographyPresent(rows, 'zip', '90706');
  assert.equal(r.ok, true);
  assert.match(r.detail, /2\/3/);
});

test('assertGeographyPresent tolerates padding via trimming', () => {
  const rows = [{ city: 'BELLFLOWER   ' }];
  assert.equal(assertGeographyPresent(rows, 'city', 'BELLFLOWER').ok, true);
});

test('assertGeographyPresent fails on zero rows — a 200 with no rows is a failure', () => {
  const r = assertGeographyPresent([], 'zip', '90706');
  assert.equal(r.ok, false);
  assert.match(r.detail, /not a quiet week/);
});

test('assertGeographyPresent fails and shows what it DID see (wrong jurisdiction)', () => {
  const rows = [{ zip: '20015' }, { zip: '20016' }];
  const r = assertGeographyPresent(rows, 'zip', '90706');
  assert.equal(r.ok, false);
  assert.match(r.detail, /20015/);
  assert.match(r.detail, /wrong jurisdiction/);
});

/* ------------------------------------------------------------- padding trap */
test('assertPaddingTrapStillExists: 0 means the trap is intact, keep the workaround', async () => {
  const r = await assertPaddingTrapStillExists(async () => 0);
  assert.equal(r.ok, true);
  assert.match(r.detail, /intact/);
});

test('assertPaddingTrapStillExists: non-zero means upstream fixed it and YOUR code is now suspect', async () => {
  const r = await assertPaddingTrapStillExists(async () => 4285);
  assert.equal(r.ok, false);
  assert.match(r.detail, /UPSTREAM APPEARS FIXED/);
});

test('assertPaddingTrapStillExists reports a throwing probe rather than crashing', async () => {
  const r = await assertPaddingTrapStillExists(async () => { throw new Error('boom'); });
  assert.equal(r.ok, false);
  assert.match(r.detail, /boom/);
});

/* ----------------------------------------------------------- classification */
test('assertClassificationResolves passes while the codes still match', () => {
  const vals = ['CODE 6', 'TRAFFIC STOP', 'BURGLARY'];
  const r = assertClassificationResolves(vals, /CODE 6|TRAFFIC STOP/);
  assert.equal(r.ok, true);
  assert.match(r.detail, /2\/3/);
});

test('assertClassificationResolves fails when a rename silently collapses the split', () => {
  const vals = ['ONVIEW INCIDENT', 'VEHICLE STOP'];   // renamed upstream
  const r = assertClassificationResolves(vals, /CODE 6|TRAFFIC STOP/);
  assert.equal(r.ok, false);
  assert.match(r.detail, /misleading total/);
});

test('assertClassificationResolves honours minMatches and empty input', () => {
  assert.equal(assertClassificationResolves(['A', 'B'], /A/, { minMatches: 2 }).ok, false);
  assert.equal(assertClassificationResolves([], /A/).ok, false);
});
