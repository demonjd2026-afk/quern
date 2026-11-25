// Differential testing. Every pipeline below is executed twice: by the
// reference interpreter, and by DuckDB running the SQL the compiler generated.
// The two must return the same rows, over the example data and over randomly
// generated data sets. A disagreement means the code generator, the
// interpreter, or the type rules they share are wrong.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { generateStatements, run } from '../src/index.ts';
import type { Relation, Row, TProgram } from '../src/index.ts';
import { SCHEMA, compileOk } from './helpers.ts';

const PROGRAM = `${SCHEMA}
pipeline filters {
  from orders
  where (shipped and not (amount < 50 USD)) or placed_on >= @2026-06-01
  where discount is not null
  let ratio = discount / amount
  let big = amount >= 500 USD
}

pipeline arithmetic {
  from orders
  let net = amount - discount ?? 0 USD
  let inr = convert(net, INR, 83.25)
  let rounded = round(net / 3, 2)
  let off = abs(-(amount - 300 USD))
  let gifted = gift ?? false
  select order_id, net, inr, rounded, off, gifted, has_discount = discount is not null
}

pipeline text_functions {
  from customers
  select customer_id, shout = upper(region), quiet = lower(region), who = hash(email), ref = hash(referrer_id)
}

pipeline to_one {
  from orders
  join customers on customer_id = customers.customer_id
  group by region {
    revenue = sum(amount),
    mean = avg(amount),
    smallest = min(amount),
    latest = max(placed_on),
    orders = count(),
    buyers = count_distinct(customer_id),
    top_limit = max(credit_limit),
  }
}

pipeline outer_join {
  from customers
  left join many orders on customer_id = orders.customer_id
  let spent = amount ?? 0 USD
  group by customer_id, region { spent = sum(spent), orders = count_distinct(order_id ?? 0) }
}

pipeline line_totals {
  from order_items
  join products on product_id = products.product_id
  join orders on order_id = orders.order_id
  let line_total = quantity * price
  group by order_id, shipped { items = sum(quantity), total = sum(line_total), heaviest = max(weight ?? 0 g) }
}

pipeline fan_out {
  from orders
  join many order_items on order_id = order_items.order_id
  select order_id, line_no, product_id, share = amount / quantity
}

pipeline totals {
  from orders
  group { revenue = sum(amount), n = count(), first = min(placed_on) }
}

pipeline nothing {
  from orders
  where amount < 0 USD
  group { revenue = sum(amount), n = count() }
}

pipeline top_orders {
  from orders
  order by amount desc, order_id
  limit 5
}

pipeline nulls_last {
  from orders
  order by discount desc, order_id
}

pipeline chained {
  from to_one
  where orders >= 2
  let per_buyer = revenue / buyers
  order by region
}
`;

const PIPELINES = ['filters', 'arithmetic', 'text_functions', 'to_one', 'outer_join', 'line_totals', 'fan_out', 'totals', 'nothing', 'top_orders', 'nulls_last', 'chained'];
/** Pipelines whose final order is total, so row order itself must match. */
const ORDERED = new Set(['top_orders', 'nulls_last', 'chained']);

// ---- data ----

const EXAMPLE = join(import.meta.dirname, '..', 'examples', 'shop', 'data');

function exampleData(): Record<string, string> {
  // The example files predate two nullable columns the test schema adds.
  const addColumn = (csv: string, name: string): string =>
    csv.trimEnd().split('\n').map((line, i) => `${line},${i === 0 ? name : ''}`).join('\n') + '\n';
  const customers = readFileSync(join(EXAMPLE, 'customers.csv'), 'utf8');
  const orders = readFileSync(join(EXAMPLE, 'orders.csv'), 'utf8');
  return {
    'customers.csv': addColumn(customers, 'referrer_id'),
    'orders.csv': addColumn(orders, 'gift'),
    'order_items.csv': readFileSync(join(EXAMPLE, 'order_items.csv'), 'utf8'),
    'products.csv': readFileSync(join(EXAMPLE, 'products.csv'), 'utf8'),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomData(seed: number): Record<string, string> {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: T[]): T => xs[int(0, xs.length - 1)]!;
  const maybe = (value: string, nullRate: number): string => (rnd() < nullRate ? '' : value);
  const money = (max: number): string => (int(0, max * 100) / 100).toString();
  const regions = ['North', 'South', 'East', 'West', "O'Neil", 'Mixed Case'];

  const nCustomers = int(0, 12);
  const nProducts = int(1, 8);
  const nOrders = int(0, 40);

  const customers = ['customer_id,email,region,credit_limit,referrer_id'];
  for (let i = 1; i <= nCustomers; i++) {
    customers.push(`${i},user${i}@example.com,"${pick(regions)}",${money(9000)},${maybe(String(int(1, nCustomers)), 0.5)}`);
  }
  const products = ['product_id,title,price,weight'];
  for (let i = 1; i <= nProducts; i++) products.push(`${i},"Product ${i}",${money(300)},${maybe(String(int(1, 5000)), 0.3)}`);

  const orders = ['order_id,customer_id,placed_on,amount,discount,shipped,gift'];
  const items = ['order_id,line_no,product_id,quantity'];
  for (let i = 1; i <= nOrders; i++) {
    // Some orders point at customers that do not exist, so inner joins drop rows.
    const customer = int(1, nCustomers + 2);
    const date = `2026-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
    orders.push(`${i},${customer},${date},${money(1500)},${maybe(money(100), 0.4)},${pick(['true', 'false'])},${maybe(pick(['true', 'false']), 0.3)}`);
    const lines = int(0, 4);
    for (let l = 1; l <= lines; l++) items.push(`${i},${l},${int(1, nProducts)},${int(0, 6)}`);
  }
  const csv = (rows: string[]): string => rows.join('\n') + '\n';
  return { 'customers.csv': csv(customers), 'orders.csv': csv(orders), 'order_items.csv': csv(items), 'products.csv': csv(products) };
}

// ---- running both back ends ----

function normalise(value: unknown, base: string): string {
  if (value === null || value === undefined) return 'null';
  if (base === 'int') return String(Number(value));
  if (base === 'float') return Number(value).toPrecision(9);
  return String(value);
}

function canonical(rows: Record<string, unknown>[], rel: Relation, keepOrder: boolean): string[] {
  const lines = rows.map((row) => rel.columns.map((c) => `${c.name}=${normalise(row[c.name], c.type.base)}`).join(' | '));
  return keepOrder ? lines : lines.sort();
}

async function runBoth(program: TProgram, files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'quern-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);

  const interpreted: Map<string, Row[]> = run(program, { readSource: (p) => files[p]! });

  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  for (const statement of generateStatements(program, { resolvePath: (p) => join(dir, p) })) await connection.run(statement);
  const compiled = new Map<string, Record<string, unknown>[]>();
  for (const name of PIPELINES) {
    const reader = await connection.runAndReadAll(`SELECT * FROM "${name}"`);
    compiled.set(name, reader.getRowObjectsJson() as Record<string, unknown>[]);
  }
  connection.closeSync();
  return { interpreted, compiled };
}

function relationOf(program: TProgram, name: string): Relation {
  const item = program.items.find((i) => i.kind === 'pipeline' && i.name === name);
  if (!item || item.kind !== 'pipeline') throw new Error(name);
  return item.relation;
}

describe('interpreter and generated SQL agree', () => {
  const { program } = compileOk(PROGRAM);

  const compare = async (files: Record<string, string>): Promise<number> => {
    const { interpreted, compiled } = await runBoth(program, files);
    let rows = 0;
    for (const name of PIPELINES) {
      const rel = relationOf(program, name);
      const a = canonical(interpreted.get(name)!, rel, ORDERED.has(name));
      const b = canonical(compiled.get(name)!, rel, ORDERED.has(name));
      expect(a, `pipeline ${name}`).toEqual(b);
      rows += a.length;
    }
    return rows;
  };

  it('on the example data', async () => {
    expect(await compare(exampleData())).toBeGreaterThan(20);
  });

  it('on 40 randomly generated data sets', async () => {
    let rows = 0;
    for (let seed = 1; seed <= 40; seed++) rows += await compare(randomData(seed));
    expect(rows).toBeGreaterThan(1000);
  }, 60_000);
});

describe('published files and verification SQL', () => {
  it('COPY writes the pipeline rows to the published path', async () => {
    const { program } = compileOk(`${SCHEMA}
pipeline directory { from customers select customer_id, region, who = hash(email) order by customer_id }
publish directory to public "out/directory.csv"`);
    const dir = mkdtempSync(join(tmpdir(), 'quern-'));
    mkdirSync(join(dir, 'out'));
    const files = exampleData();
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    const connection = await (await DuckDBInstance.create(':memory:')).connect();
    for (const statement of generateStatements(program, { resolvePath: (p) => join(dir, p) })) await connection.run(statement);
    const written = readFileSync(join(dir, 'out', 'directory.csv'), 'utf8').trim().split('\n');
    expect(written[0]).toBe('customer_id,region,who');
    expect(written[1]).toBe('1,South,4a1510e2de119558027b5907568d35a2');
    expect(written).toHaveLength(5);
    connection.closeSync();
  });

  it('the verification query reports exactly the declarations the data breaks', async () => {
    const result = compileOk(`source t from "t.csv" { id: int key, name: text, note: text? }\npipeline p { from t }`);
    const dir = mkdtempSync(join(tmpdir(), 'quern-'));
    const connection = await (await DuckDBInstance.create(':memory:')).connect();
    const check = async (csv: string): Promise<string[]> => {
      writeFileSync(join(dir, 't.csv'), csv);
      for (const statement of generateStatements(result.program, { resolvePath: (p) => join(dir, p) })) await connection.run(statement);
      const reader = await connection.runAndReadAll(result.verifySql!);
      return (reader.getRowObjectsJson() as { declaration: string; violations: string }[]).map((r) => `${r.declaration}: ${r.violations}`).sort();
    };
    expect(await check('id,name,note\n1,a,\n2,b,x\n')).toEqual([]);
    expect(await check('id,name,note\n1,a,\n1,,x\n2,,\n')).toEqual(['key (id): 1', 'name is not null: 2']);
    connection.closeSync();
  });
});
