// Reference interpreter. It executes the same typed IR that the SQL generator
// compiles, directly over in-memory rows. It has no dependencies, so it runs in
// a browser, and it is the oracle for differential testing: for any program,
// the interpreter and the generated SQL must produce the same rows.

import type { Relation, TExpr, TProgram, TStep, Value } from './ir.ts';
import { isValidDate } from './lexer.ts';
import { md5 } from './md5.ts';

export type Row = Record<string, Value>;

export class RuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface RunOptions {
  /** Returns the raw text of a source file given the path written in the program. */
  readSource: (path: string) => string;
}

/** Runs every source and pipeline; returns the rows of each by name. */
export function run(program: TProgram, options: RunOptions): Map<string, Row[]> {
  const tables = new Map<string, Row[]>();
  for (const item of program.items) {
    if (item.kind === 'source') {
      tables.set(item.name, loadCsv(item.name, options.readSource(item.path), item.relation));
    } else if (item.kind === 'pipeline') {
      let rows: Row[] = [];
      for (const step of item.steps) rows = runStep(step, rows, tables);
      tables.set(item.name, rows);
    }
  }
  return tables;
}

// ---- loading and verifying sources ----

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const src = input.replace(/^﻿/, '');
  const endRow = (): void => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      i++;
      endRow();
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Loads a CSV into typed rows and checks it against the declared schema. The
 * type checker's guarantees rest on these declarations, so a source that
 * breaks one (a null in a non-null column, a repeated key) is rejected here.
 */
export function loadCsv(name: string, content: string, rel: Relation): Row[] {
  const records = parseCsv(content);
  const header = records[0];
  if (!header) throw new RuntimeError('R0003', `source '${name}': the file is empty`);
  const index = rel.columns.map((c) => {
    const at = header.indexOf(c.name);
    if (at < 0) throw new RuntimeError('R0003', `source '${name}': the file has no column '${c.name}'`);
    return at;
  });

  const rows: Row[] = [];
  for (let r = 1; r < records.length; r++) {
    const record = records[r]!;
    const row: Row = {};
    rel.columns.forEach((c, k) => {
      const raw = record[index[k]!] ?? '';
      const where = `source '${name}', row ${r}, column '${c.name}'`;
      if (raw === '') {
        if (!c.type.nullable) throw new RuntimeError('R0001', `${where}: empty value in a column declared non-null`);
        row[c.name] = null;
        return;
      }
      row[c.name] = parseValue(raw, c.type.base, where);
    });
    rows.push(row);
  }

  for (const key of rel.keys) {
    const seen = new Set<string>();
    for (const row of rows) {
      const id = JSON.stringify(key.map((k) => row[k]));
      if (seen.has(id)) throw new RuntimeError('R0002', `source '${name}': key (${key.join(', ')}) is not unique; ${id} appears more than once`);
      seen.add(id);
    }
  }
  return rows;
}

function parseValue(raw: string, base: Relation['columns'][number]['type']['base'], where: string): Value {
  switch (base) {
    case 'int': {
      if (!/^-?\d+$/.test(raw)) throw new RuntimeError('R0003', `${where}: '${raw}' is not an int`);
      const n = Number(raw);
      if (!Number.isSafeInteger(n)) throw new RuntimeError('R0003', `${where}: ${raw} is outside the exactly representable integer range`);
      return n;
    }
    case 'float': {
      const n = Number(raw);
      if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw) || !Number.isFinite(n)) throw new RuntimeError('R0003', `${where}: '${raw}' is not a float`);
      return n;
    }
    case 'bool':
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new RuntimeError('R0003', `${where}: '${raw}' is not a bool (expected true or false)`);
    case 'date':
      if (!isValidDate(raw)) throw new RuntimeError('R0003', `${where}: '${raw}' is not a date (expected YYYY-MM-DD)`);
      return raw;
    case 'text':
      return raw;
  }
}

// ---- steps ----

function runStep(step: TStep, input: Row[], tables: Map<string, Row[]>): Row[] {
  switch (step.kind) {
    case 'from':
      return tables.get(step.relation)!;
    case 'join': {
      const right = tables.get(step.relation)!;
      const index = new Map<string, Row[]>();
      for (const r of right) {
        const id = JSON.stringify(step.on.map((p) => r[p.right]));
        const bucket = index.get(id);
        if (bucket) bucket.push(r);
        else index.set(id, [r]);
      }
      const out: Row[] = [];
      for (const l of input) {
        const matches = index.get(JSON.stringify(step.on.map((p) => l[p.left])));
        if (matches) {
          for (const r of matches) {
            const row: Row = { ...l };
            for (const c of step.rightColumns) row[c] = r[c]!;
            out.push(row);
          }
        } else if (step.outer) {
          const row: Row = { ...l };
          for (const c of step.rightColumns) row[c] = null;
          out.push(row);
        }
      }
      return out;
    }
    case 'where':
      return input.filter((row) => evaluate(step.predicate, row) === true);
    case 'let':
      return input.map((row) => ({ ...row, [step.name]: evaluate(step.value, row) }));
    case 'select':
      return input.map((row) => {
        const out: Row = {};
        for (const item of step.items) out[item.name] = evaluate(item.value, row);
        return out;
      });
    case 'group': {
      const groups = new Map<string, Row[]>();
      for (const row of input) {
        const id = JSON.stringify(step.keys.map((k) => row[k]));
        const bucket = groups.get(id);
        if (bucket) bucket.push(row);
        else groups.set(id, [row]);
      }
      // A group with no keys always yields exactly one row, even over no input.
      if (step.keys.length === 0 && groups.size === 0) groups.set('[]', []);
      const out: Row[] = [];
      for (const rows of groups.values()) {
        const result: Row = {};
        for (const k of step.keys) result[k] = rows[0]![k]!;
        for (const agg of step.aggregates) {
          const values = agg.arg ? rows.map((r) => evaluate(agg.arg!, r)).filter((v) => v !== null) : [];
          result[agg.name] = aggregate(agg.fn, values, rows.length);
        }
        out.push(result);
      }
      return out;
    }
    case 'order': {
      const sorted = [...input].sort((a, b) => {
        for (const k of step.keys) {
          const x = a[k.column]!;
          const y = b[k.column]!;
          if (x === y) continue;
          if (x === null) return 1; // nulls last, in both directions
          if (y === null) return -1;
          const cmp = x < y ? -1 : 1;
          return k.descending ? -cmp : cmp;
        }
        return 0;
      });
      return step.limit === null ? sorted : sorted.slice(0, step.limit);
    }
  }
}

function aggregate(fn: string, values: Value[], rowCount: number): Value {
  switch (fn) {
    case 'count':
      return rowCount;
    case 'count_distinct':
      return new Set(values).size;
    case 'sum':
      return values.length === 0 ? null : (values as number[]).reduce((a, b) => a + b, 0);
    case 'avg':
      return values.length === 0 ? null : (values as number[]).reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return values.length === 0 ? null : values.reduce((a, b) => (b! < a! ? b : a));
    default:
      return values.length === 0 ? null : values.reduce((a, b) => (b! > a! ? b : a));
  }
}

// ---- expressions ----

export function evaluate(e: TExpr, row: Row): Value {
  switch (e.kind) {
    case 'column':
      return row[e.name]!;
    case 'literal':
      return e.value;
    case 'arith': {
      const l = evaluate(e.left, row) as number | null;
      const r = evaluate(e.right, row) as number | null;
      if (l === null || r === null) return null;
      if (e.op === '+') return l + r;
      if (e.op === '-') return l - r;
      if (e.op === '*') return l * r;
      return r === 0 ? null : l / r;
    }
    case 'compare': {
      const l = evaluate(e.left, row);
      const r = evaluate(e.right, row);
      if (l === null || r === null) return null;
      switch (e.op) {
        case '=':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return l < r;
        case '<=':
          return l <= r;
        case '>':
          return l > r;
        default:
          return l >= r;
      }
    }
    case 'logic': {
      const l = evaluate(e.left, row);
      const r = evaluate(e.right, row);
      return e.op === 'and' ? l === true && r === true : l === true || r === true;
    }
    case 'not':
      return evaluate(e.operand, row) !== true;
    case 'negate': {
      const v = evaluate(e.operand, row) as number | null;
      return v === null ? null : -v;
    }
    case 'isnull': {
      const isNull = evaluate(e.operand, row) === null;
      return e.negated ? !isNull : isNull;
    }
    case 'coalesce': {
      const l = evaluate(e.left, row);
      return l !== null ? l : evaluate(e.right, row);
    }
    case 'call': {
      const a = evaluate(e.args[0]!, row);
      if (a === null) return null;
      switch (e.fn) {
        case 'hash':
          return md5(String(a));
        case 'lower':
          return (a as string).toLowerCase();
        case 'upper':
          return (a as string).toUpperCase();
        case 'abs':
          return Math.abs(a as number);
        case 'round': {
          // Round half away from zero, matching SQL's round().
          const scale = 10 ** (evaluate(e.args[1]!, row) as number);
          const x = a as number;
          return (Math.sign(x) * Math.round(Math.abs(x) * scale)) / scale;
        }
        case 'convert': {
          const rate = evaluate(e.args[1]!, row) as number | null;
          return rate === null ? null : (a as number) * rate;
        }
      }
    }
  }
}
