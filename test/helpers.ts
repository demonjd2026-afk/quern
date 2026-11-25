import { compile } from '../src/index.ts';
import type { CompileResult, TProgram } from '../src/index.ts';

/** Shared schema used by most tests. */
export const SCHEMA = `
source customers from "customers.csv" {
  customer_id:  int key,
  email:        text pii,
  region:       text,
  credit_limit: float<USD>,
  referrer_id:  int?,
}
source orders from "orders.csv" {
  order_id:    int key,
  customer_id: int,
  placed_on:   date,
  amount:      float<USD>,
  discount:    float<USD>?,
  shipped:     bool,
  gift:        bool?,
}
source order_items from "order_items.csv" {
  order_id:   int,
  line_no:    int,
  product_id: int,
  quantity:   int,
  key (order_id, line_no),
}
source products from "products.csv" {
  product_id: int key,
  title:      text,
  price:      float<USD>,
  weight:     int<g>?,
}
`;

export function codes(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.code);
}

export function compileOk(source: string): CompileResult & { program: TProgram; sql: string } {
  const result = compile(source);
  if (!result.ok || !result.program || result.sql === null) {
    throw new Error('expected a clean compile, got: ' + result.diagnostics.map((d) => `${d.code} ${d.message}`).join('; '));
  }
  return result as CompileResult & { program: TProgram; sql: string };
}

export function pipelineType(source: string, name: string) {
  const item = compileOk(source).program.items.find((i) => i.kind === 'pipeline' && i.name === name);
  if (!item || item.kind !== 'pipeline') throw new Error(`no pipeline ${name}`);
  return item.relation;
}
