/**
 * SDLC doc gate for v0.2.0: fails if any of the five docs is missing, if any
 * doc does not reference version 0.2.0, or if a requirements-matrix row lacks
 * a test ref / cites a case id absent from TEST-CASES.md.
 *
 * Run: node --test --experimental-strip-types tests/*.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = ['BRD.md', 'PRD.md', 'requirements-matrix.md', 'TEST-PLAN.md', 'TEST-CASES.md'];

function readDoc(name: string): string {
  const p = join(root, 'docs', name);
  assert.ok(existsSync(p), `docs/${name} is missing`);
  return readFileSync(p, 'utf8');
}

describe('sdlc docs gate (v0.2.0)', () => {
  it('all five docs exist and reference 0.2.0', () => {
    for (const name of docs) {
      const text = readDoc(name);
      assert.ok(text.includes('0.2.0'), `docs/${name} does not reference 0.2.0`);
    }
  });

  it('every matrix row has a test ref present in TEST-CASES.md', () => {
    const matrix = readDoc('requirements-matrix.md');
    const cases = readDoc('TEST-CASES.md');
    const defined = new Set([...cases.matchAll(/\b(TC-\d{2})\b/g)].map((m) => m[1]));
    assert.ok(defined.size > 0, 'no TC-xx ids found in TEST-CASES.md');
    const rows = matrix.split('\n').filter((l) => /\bR\d+\b/.test(l) && /\bTC-\d{2}\b/.test(l) === false && l.includes('|'));
    // Rows mentioning an R-req must cite at least one TC id; collect R-rows first.
    const rRows = matrix.split('\n').filter((l) => l.includes('|') && /\bR[1-9]\b/.test(l));
    assert.ok(rRows.length > 0, 'no requirement rows found in matrix');
    assert.deepEqual(rows, [], 'matrix has requirement rows without test refs');
    for (const row of rRows) {
      const cited = [...row.matchAll(/\b(TC-\d{2})\b/g)].map((m) => m[1]);
      assert.ok(cited.length > 0, `matrix row lacks a test ref: ${row.trim()}`);
      for (const id of cited) {
        assert.ok(defined.has(id), `matrix cites ${id} absent from TEST-CASES.md`);
      }
    }
  });
});
