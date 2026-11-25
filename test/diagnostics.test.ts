// One minimal program per diagnostic code. The last test fails if a code in
// the catalogue has no case here, so the catalogue cannot list a diagnostic
// the compiler is not shown to produce.

import { describe, expect, it } from 'vitest';
import { CODES, compile, render } from '../src/index.ts';
import { SCHEMA, codes } from './helpers.ts';

const p = (body: string): string => `${SCHEMA}\npipeline t {\n${body}\n}\n`;

const CASES: [code: string, name: string, source: string][] = [
  ['E0001', 'stray character', 'pipeline t { from x where a # 1 }'],
  ['E0001', 'impossible date', p('from orders where placed_on > @2026-02-30')],
  ['E0002', 'unterminated string', 'source s from "data.csv { a: int }'],
  ['E0003', 'missing brace', 'pipeline t  from orders }'],
  ['E0003', 'reserved word as a name', 'pipeline order { from orders }'],
  ['E0101', 'unknown column', p('from orders where amuont > 0 USD')],
  ['E0101', 'wrong qualifier', p('from orders join customers on customer_id = customers.customer_id where orders.region = "x"')],
  ['E0102', 'unknown relation', p('from ordres')],
  ['E0103', 'text plus number', p('from orders let x = amount + "a"')],
  ['E0103', 'where on a number', p('from orders where amount')],
  ['E0104', 'duplicate source', `${SCHEMA}\nsource orders from "o.csv" { a: int }`],
  ['E0104', 'let reuses a name', p('from orders let amount = 1')],
  ['E0104', 'join name clash', p('from orders join many order_items on order_id = order_items.order_id join many order_items on order_id = order_items.order_id')],
  ['E0106', 'unknown function', p('from orders let x = sqroot(amount)')],
  ['E0106', 'group output is not an aggregate', p('from orders group by customer_id { x = amount }')],
  ['E0107', 'aggregate in let', p('from orders let x = sum(amount)')],
  ['E0108', 'no from', p('where true')],
  ['E0108', 'join condition on one side', p('from orders join customers on order_id = customer_id')],
  ['E0201', 'compare a nullable', p('from orders where discount > 0 USD')],
  ['E0201', 'nullable bool in where', p('from orders where gift')],
  ['E0201', 'nullable key', 'source s from "s.csv" { id: int? key }'],
  ['E0202', 'sum of a nullable', p('from orders group by customer_id { d = sum(discount) }')],
  ['E0202', 'quotient is nullable', p('from orders let r = amount / amount group { a = avg(r) }')],
  ['E0203', 'join on a nullable', p('from customers join customers_copy on referrer_id = customers_copy.id').replace('pipeline t', 'source customers_copy from "c.csv" { id: int key }\npipeline t')],
  ['E0300', 'fan-out without many', p('from orders join order_items on order_id = order_items.order_id')],
  ['E0301', 'sum over the fanned-out side', p('from orders join many order_items on order_id = order_items.order_id group by customer_id { total = sum(amount) }')],
  ['E0301', 'sum over the to-one side (fan trap)', p('from orders join customers on customer_id = customers.customer_id group by region { limit_total = sum(credit_limit) }')],
  ['E0401', 'pii to public', `${p('from customers select customer_id, email')}\npublish t to public "out.csv"`],
  ['E0401', 'pii survives lower() and max()', `${p('from customers let e = lower(email) group by region { m = max(e) }')}\npublish t to public "out.csv"`],
  ['E0501', 'USD plus grams', p('from order_items join products on product_id = products.product_id where weight is not null let x = price + weight')],
  ['E0501', 'literal without a unit', p('from orders where amount > 100')],
  ['E0502', 'USD times USD', p('from orders let x = amount * amount')],
  ['E0502', 'unit on text', 'source s from "s.csv" { name: text<USD> }'],
  ['E0601', 'limit alone', p('from orders limit 5')],
  ['E0602', 'order then where', p('from orders order by amount where shipped')],
  ['W0201', '?? on non-null', p('from orders let x = amount ?? 0 USD')],
  ['W0300', 'many on a to-one join', p('from orders join many customers on customer_id = customers.customer_id')],
  ['W0601', 'limit with ties', p('from orders order by amount limit 3')],
];

describe('diagnostics', () => {
  for (const [code, name, source] of CASES) {
    it(`${code}: ${name}`, () => {
      expect(codes(source)).toContain(code);
    });
  }

  it('every code in the catalogue has a test case', () => {
    const covered = new Set(CASES.map((c) => c[0]));
    expect(Object.keys(CODES).filter((c) => !covered.has(c))).toEqual([]);
  });

  it('warnings do not fail the compile', () => {
    const result = compile(p('from orders order by amount limit 3'));
    expect(result.ok).toBe(true);
    expect(result.sql).not.toBeNull();
  });

  it('reports errors in separate pipelines in one pass', () => {
    const source = `${SCHEMA}
pipeline a { from orders where discount > 0 USD }
pipeline b { from orders let x = amount + 1 }
pipeline c { from b }`;
    // c reads the broken b; that must not add a third, cascading error.
    expect(codes(source)).toEqual(['E0201', 'E0501']);
  });

  it('suggests a close name', () => {
    const d = compile(p('from orders where amuont > 0 USD')).diagnostics[0]!;
    expect(d.hint).toBe("did you mean 'amount'?");
  });

  it('renders the source line with a caret under the span', () => {
    const source = 'pipeline t {\n  from nowhere\n}';
    const d = compile(source).diagnostics[0]!;
    expect(render(d, source, 'x.quern')).toBe(
      ["error[E0102]: unknown source or pipeline 'nowhere'", ' --> x.quern:2:8', '  |', '2 |   from nowhere', '  |        ^^^^^^^'].join('\n'),
    );
  });
});
