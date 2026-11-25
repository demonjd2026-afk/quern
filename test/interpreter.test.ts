import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RuntimeError, parseCsv, run } from '../src/index.ts';
import { md5 } from '../src/md5.ts';
import { compileOk } from './helpers.ts';

const SOURCE = `
source t from "t.csv" { id: int key, name: text, score: float?, born: date }
pipeline out { from t }
`;

function load(csv: string) {
  return run(compileOk(SOURCE).program, { readSource: () => csv }).get('out')!;
}

function failure(csv: string): string {
  try {
    load(csv);
  } catch (e) {
    if (e instanceof RuntimeError) return e.code;
    throw e;
  }
  return 'no error';
}

describe('csv loading', () => {
  it('parses quoted fields, escaped quotes, CRLF and embedded newlines', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });
  it('types values by the declared schema, in declared order, ignoring extra columns', () => {
    expect(load('extra,born,score,name,id\nq,2026-01-31,,Ann,7\n')).toEqual([{ id: 7, name: 'Ann', score: null, born: '2026-01-31' }]);
  });
});

describe('source verification', () => {
  it('R0001: empty value in a non-null column', () => {
    expect(failure('id,name,score,born\n1,,2.5,2026-01-01\n')).toBe('R0001');
  });
  it('R0002: repeated key', () => {
    expect(failure('id,name,score,born\n1,a,,2026-01-01\n1,b,,2026-01-02\n')).toBe('R0002');
  });
  it('R0003: value of the wrong type, impossible date, missing column', () => {
    expect(failure('id,name,score,born\nx,a,,2026-01-01\n')).toBe('R0003');
    expect(failure('id,name,score,born\n1,a,,2026-02-30\n')).toBe('R0003');
    expect(failure('id,name,score\n1,a,\n')).toBe('R0003');
  });
});

describe('md5', () => {
  it('matches node:crypto, including multi-block and non-ASCII input', () => {
    const inputs = ['', 'a', 'asha@example.com', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'naïve ☕ 日本語'];
    for (const input of inputs) {
      expect(md5(input)).toBe(createHash('md5').update(input, 'utf8').digest('hex'));
    }
  });
});
