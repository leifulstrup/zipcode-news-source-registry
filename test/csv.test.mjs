import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLUMNS, REQUIRED, serializeValue, serializeRow, serialize,
  parse, parseObjects, missingRequired,
} from '../lib/csv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('serializeValue quotes only when it must', () => {
  assert.equal(serializeValue('plain'), 'plain');
  assert.equal(serializeValue('has,comma'), '"has,comma"');
  assert.equal(serializeValue('has"quote'), '"has""quote"');
  assert.equal(serializeValue('has\nnewline'), '"has\nnewline"');
  assert.equal(serializeValue(null), '');
  assert.equal(serializeValue(undefined), '');
  assert.equal(serializeValue(0), '0');
});

test('parse handles quoted commas, escaped quotes and embedded newlines', () => {
  const text = 'a,b,c\n1,"two, with comma","he said ""hi"""\n';
  assert.deepEqual(parse(text), [
    ['a', 'b', 'c'],
    ['1', 'two, with comma', 'he said "hi"'],
  ]);
});

test('parse keeps embedded newlines inside quotes', () => {
  const rows = parse('a,b\n"line1\nline2",x\n');
  assert.equal(rows[1][0], 'line1\nline2');
  assert.equal(rows[1][1], 'x');
});

test('round trip: serialize then parse returns the original values', () => {
  const row = Object.fromEntries(COLUMNS.map(c => [c, '']));
  Object.assign(row, {
    source_id: 'ca-06037-test',
    jurisdiction: 'Los Angeles County, CA',
    traps: 'padded field; equality returns 0, use LIKE; "quoted" bit',
    insights: 'measures deployment, not demand',
  });
  const back = parseObjects(serialize([row]))[0];
  assert.equal(back.source_id, 'ca-06037-test');
  assert.equal(back.jurisdiction, 'Los Angeles County, CA');
  assert.equal(back.traps, 'padded field; equality returns 0, use LIKE; "quoted" bit');
  assert.equal(Object.keys(back).length, COLUMNS.length);
});

test('serializeRow emits exactly one field per schema column', () => {
  const line = serializeRow(Object.fromEntries(COLUMNS.map(c => [c, 'x'])));
  assert.equal(parse(line + '\n')[0].length, COLUMNS.length);
});

test('missingRequired names the blanks a contributor still has to fill', () => {
  const empty = Object.fromEntries(COLUMNS.map(c => [c, '']));
  assert.deepEqual(missingRequired(empty), REQUIRED);

  const full = Object.fromEntries(REQUIRED.map(c => [c, 'v']));
  assert.deepEqual(missingRequired(full), []);

  assert.deepEqual(missingRequired({ ...full, name: '   ' }), ['name']);
});

test('the shipped data files match the schema exactly', () => {
  const dir = join(ROOT, 'data');
  const files = readdirSync(dir).filter(f => f.endsWith('.csv'));
  assert.ok(files.length > 0, 'expected at least one state file');

  for (const file of files) {
    const rows = parse(readFileSync(join(dir, file), 'utf8')).filter(r => r.length > 1);
    assert.deepEqual(rows[0], COLUMNS, `${file} header must match lib/csv.mjs COLUMNS`);
    for (const [i, r] of rows.entries()) {
      assert.equal(r.length, COLUMNS.length, `${file} row ${i} has ${r.length} fields, expected ${COLUMNS.length}`);
    }
  }
});

test('every shipped row carries its required columns', () => {
  const dir = join(ROOT, 'data');
  for (const file of readdirSync(dir).filter(f => f.endsWith('.csv'))) {
    for (const row of parseObjects(readFileSync(join(dir, file), 'utf8'))) {
      assert.deepEqual(
        missingRequired(row), [],
        `${file}: ${row.source_id || '(no id)'} is missing required columns`,
      );
    }
  }
});
