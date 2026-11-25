// What the checker infers when a program is correct.

import { describe, expect, it } from 'vitest';
import { showType } from '../src/index.ts';
import { SCHEMA, codes, compileOk, pipelineType } from './helpers.ts';

const p = (body: string): string => `${SCHEMA}\npipeline t {\n${body}\n}\n`;
const typeOf = (body: string, column: string): string => {
  const col = pipelineType(p(body), 't').columns.find((c) => c.name === column);
  if (!col) throw new Error(`no column ${column}`);
  return showType(col.type);
};

describe('nullability', () => {
  it('?? removes nullability', () => {
    expect(typeOf('from orders let d = discount ?? 0 USD', 'd')).toBe('float<USD>');
  });
  it('?? binds tighter than arithmetic', () => {
    expect(typeOf('from orders let net = amount - discount ?? 0 USD', 'net')).toBe('float<USD>');
  });
  it('arithmetic propagates nullability', () => {
    expect(typeOf('from orders let net = amount - discount', 'net')).toBe('float<USD>?');
  });
  it('where ... is not null narrows the column afterwards', () => {
    expect(typeOf('from orders where discount is not null and shipped', 'discount')).toBe('float<USD>');
    expect(codes(p('from orders where discount is not null where discount > 0 USD'))).toEqual([]);
  });
  it('`or` does not narrow', () => {
    expect(typeOf('from orders where discount is not null or shipped', 'discount')).toBe('float<USD>?');
  });
  it('a left join makes the right-hand columns nullable', () => {
    expect(typeOf('from orders left join customers on customer_id = customers.customer_id', 'region')).toBe('text?');
  });
  it('division is nullable unless the divisor is a non-zero literal', () => {
    expect(typeOf('from order_items let x = quantity / line_no', 'x')).toBe('float?');
    expect(typeOf('from order_items let x = quantity / 2', 'x')).toBe('float');
    expect(typeOf('from order_items let x = quantity / 0', 'x')).toBe('float?');
  });
  it('a keyed group gives non-null aggregates; a global group does not', () => {
    expect(typeOf('from orders group by customer_id { s = sum(amount) }', 's')).toBe('float<USD>');
    expect(typeOf('from orders group { s = sum(amount), n = count() }', 's')).toBe('float<USD>?');
    expect(typeOf('from orders group { s = sum(amount), n = count() }', 'n')).toBe('int');
  });
});

describe('units', () => {
  it('scaling keeps the unit; a same-unit ratio is a plain number', () => {
    expect(typeOf('from orders let x = amount * 2', 'x')).toBe('float<USD>');
    expect(typeOf('from orders let x = (discount ?? 0 USD) / amount', 'x')).toBe('float?');
  });
  it('convert changes the unit', () => {
    expect(typeOf('from orders let inr = convert(amount, INR, 83.2)', 'inr')).toBe('float<INR>');
  });
  it('aggregates keep the unit, count drops it', () => {
    expect(typeOf('from orders group by customer_id { m = max(amount) }', 'm')).toBe('float<USD>');
  });
});

describe('pii', () => {
  it('flows through expressions and is cleared only by hash and counts', () => {
    expect(typeOf('from customers let e = upper(email)', 'e')).toBe('text pii');
    expect(typeOf('from customers let e = hash(email)', 'e')).toBe('text');
    expect(typeOf('from customers group by region { n = count_distinct(email) }', 'n')).toBe('int');
    expect(typeOf('from customers let has = email is not null', 'has')).toBe('bool pii');
  });
  it('a restricted sink accepts pii', () => {
    expect(codes(`${p('from customers')}\npublish t to restricted "out.csv"`)).toEqual([]);
  });
});

describe('keys and grain', () => {
  const keys = (body: string): string[][] => pipelineType(p(body), 't').keys;

  it('a to-one join keeps the left key', () => {
    expect(keys('from orders join customers on customer_id = customers.customer_id')).toEqual([['order_id']]);
  });
  it('join many combines both keys', () => {
    expect(keys('from orders join many order_items on order_id = order_items.order_id')).toEqual([['order_id', 'line_no']]);
  });
  it('joining many rows back to their parent keeps the child key', () => {
    expect(keys('from order_items join orders on order_id = orders.order_id')).toEqual([['order_id', 'line_no']]);
  });
  it('group by sets the key, dropping columns determined by a to-one join', () => {
    expect(keys('from orders group by customer_id, shipped { n = count() }')).toEqual([['customer_id', 'shipped']]);
    expect(keys('from order_items join products on product_id = products.product_id group by product_id, title { n = count() }')).toEqual([['product_id']]);
  });
  it('select keeps a key only if all its columns survive, following renames', () => {
    expect(keys('from orders select id = order_id, amount')).toEqual([['id']]);
    expect(keys('from orders select customer_id, amount')).toEqual([]);
  });
  it('a global group has the empty key (at most one row)', () => {
    expect(keys('from orders group { n = count() }')).toEqual([[]]);
  });

  it('min, max and count_distinct are allowed over duplicated columns', () => {
    expect(codes(p('from orders join customers on customer_id = customers.customer_id group by region { m = max(credit_limit), c = count_distinct(credit_limit) }'))).toEqual([]);
  });
  it('an expression anchored at the current grain may be summed', () => {
    expect(codes(p('from order_items join products on product_id = products.product_id group by order_id { total = sum(quantity * price) }'))).toEqual([]);
  });
  it('duplication is remembered across pipelines', () => {
    const source = `${SCHEMA}
pipeline joined { from orders join customers on customer_id = customers.customer_id }
pipeline t { from joined group by region { x = sum(credit_limit) } }`;
    expect(codes(source)).toEqual(['E0301']);
  });
  it('grouping to one row per value clears duplication', () => {
    const source = p(`from orders join customers on customer_id = customers.customer_id
      group by customer_id, credit_limit { n = count() }
      group { total_limit = sum(credit_limit) }`);
    expect(codes(source)).toEqual([]);
  });
});

describe('sql output', () => {
  it('emits one CTE per step and casts computed columns to their inferred type', () => {
    const { sql } = compileOk(p('from orders where shipped let net = amount - discount ?? 0 USD'));
    expect(sql).toContain(
      [
        'CREATE OR REPLACE VIEW "t" AS',
        'WITH',
        '  s0 AS (SELECT * FROM "orders"),',
        '  s1 AS (SELECT * FROM s0 WHERE "shipped"),',
        '  s2 AS (SELECT *, CAST(("amount" - COALESCE("discount", CAST(0 AS BIGINT))) AS DOUBLE) AS "net" FROM s1)',
        'SELECT * FROM s2;',
      ].join('\n'),
    );
  });
  it('escapes quotes in strings', () => {
    const { sql } = compileOk(p(`from customers where region = "O'Brien"`));
    expect(sql).toContain(`'O''Brien'`);
  });
});
