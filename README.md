# Quern

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20dependencies-0-success.svg)

**A typed data-pipeline language where data bugs are compile errors.** Quern compiles to SQL.

SQL will happily run a query that double-counts revenue, drops the rows with a null in them, adds dollars to grams, or copies email addresses into a public table. Each of those is a wrong answer, not an error, so it is found later, by someone looking at a dashboard.

Quern is a small language for writing the same pipelines in which those four mistakes do not type-check.

```
pipeline credit_exposure {
  from orders
  join customers on customer_id = customers.customer_id
  group by region { exposure = sum(credit_limit) }
}
```

```
error[E0301]: sum would count the same values more than once: the join repeats each 'customers' row once per matching input row
  --> examples/shop/bugs.quern:34:36
   |
34 |   group by region { exposure = sum(credit_limit) }
   |                                    ^^^^^^^^^^^^
   = hint: aggregate this column before the join, or use an expression that includes a column at the current grain
```

## What the type system tracks

A column's type is its base type (`int`, `float`, `text`, `bool`, `date`) plus four facts that the compiler carries through every step.

| Fact | Declared as | What is rejected |
| --- | --- | --- |
| **Nullability** | `discount: float<USD>?` | Comparing, filtering on, joining on, or aggregating a value that may be null. Handle it with `??`, `is null`, or `where x is not null`, which narrows the type for the steps that follow. |
| **Keys and grain** | `order_id: int key`, `key (order_id, line_no)` | A join that can multiply rows unless it says `join many`. `sum` or `avg` over a column whose rows a join has repeated. |
| **PII** | `email: text pii` | Publishing a PII-derived column to a `public` sink. `hash(...)` is the only function that clears the mark. |
| **Units** | `amount: float<USD>`, `weight: int<g>` | Adding or comparing values in different units, including a bare literal: write `100 USD`, not `100`. |

Three further rules follow from the same idea:

- Division by zero gives null, so a quotient is nullable unless the divisor is a non-zero literal.
- `sum`, `avg`, `min` and `max` over a whole table (a `group` with no keys) are nullable, because the table may be empty. With group keys they are not.
- `limit` needs an `order by` directly before it, and the compiler warns when the order can have ties.

## Try it

Requires Node 22 or later.

```sh
npm install
npm test

npm run quern -- check   examples/shop/bugs.quern    # five bugs, five errors
npm run quern -- run     examples/shop/shop.quern    # execute with the interpreter
npm run quern -- compile examples/shop/shop.quern    # print the generated SQL
npm run quern -- types   examples/shop/shop.quern    # inferred types and keys
npm run quern -- verify  examples/shop/shop.quern    # SQL that tests the source declarations
```

[`examples/shop/shop.quern`](examples/shop/shop.quern) is a complete program. [`examples/shop/bugs.quern`](examples/shop/bugs.quern) holds five pipelines that look reasonable, run without complaint as SQL, and are each wrong.

## The language in one example

```
source orders from "data/orders.csv" {
  order_id:    int key,
  customer_id: int,
  placed_on:   date,
  amount:      float<USD>,
  discount:    float<USD>?,
  shipped:     bool,
}

pipeline shipped_orders {
  from orders
  where shipped and placed_on >= @2026-10-01
  let net = amount - discount ?? 0 USD
}

pipeline revenue_by_region {
  from shipped_orders
  join customers on customer_id = customers.customer_id
  group by region {
    revenue = sum(net),
    orders  = count(),
  }
  order by revenue desc
}

publish revenue_by_region to public "out/revenue_by_region.csv"
```

A program is a list of `source`, `pipeline` and `publish` declarations. A pipeline is a `from` followed by steps, read top to bottom:

| Step | Form |
| --- | --- |
| `join` | `[left] join [many] <relation> on a = <relation>.b [and ...]` |
| `where` | `where <bool expression>` |
| `let` | `let name = <expression>` (adds a column; never overwrites one) |
| `select` | `select a, b, name = <expression>` |
| `group` | `group [by a, b] { name = <aggregate>(...), ... }` |
| `order by` | `order by a [desc], b` (last step, or directly before `limit`) |
| `limit` | `limit n` |

Operators, loosest to tightest: `or`, `and`, `not`, comparisons and `is [not] null`, `+ -`, `* /`, `??`, unary `-`.
Scalar functions: `hash`, `lower`, `upper`, `abs`, `round`, `convert(value, UNIT, rate)`.
Aggregates: `sum`, `avg`, `min`, `max`, `count()`, `count_distinct`.

## How it is built

```
source text
   │  lexer.ts        tokens
   │  parser.ts       AST (recursive descent, resynchronises after an error)
   │  checker.ts      typed IR: every step carries its relation type
   ├──► sql.ts          DuckDB SQL: one view per pipeline, one CTE per step
   └──► interpreter.ts  executes the same IR in memory
```

The compiler is written in TypeScript with no runtime dependencies. `compile()` is a pure function from text to diagnostics, IR and SQL, so it runs in a browser as well as in Node.

There are two back ends on purpose. The SQL generator is the product. The interpreter is the oracle: the test suite runs every test pipeline through both, over the example data and over 40 randomly generated data sets, and requires identical rows. That check has already caught a real defect during development (the SQL read CSV columns by position while the interpreter read them by name).

### What the guarantees rest on

The checker reasons from what each `source` declares. If a file breaks a declaration (a null in a non-null column, a repeated key), the conclusions do not hold. So the declarations are checked against the data: the interpreter refuses such a file when it loads it, and `quern verify` emits a SQL query that returns one row per violated declaration.

## Limits, stated plainly

- PII tracking follows explicit flows only (values computed from a PII column). It does not track what a `where` on a PII column reveals about the rows that remain.
- The duplication rule is conservative by design and has one heuristic: an expression is treated as safe to sum if at least one column in it is at the current grain (`quantity * price` after joining products to order lines).
- `float` is a 64-bit float and `int` is exact up to 2^53 in the interpreter. There is no fixed-point decimal type yet.
- Units are single names. There are no compound units such as `USD/kg`.
- The SQL target is DuckDB. Sources are CSV files.
- A group output is a single aggregate call; ratios of aggregates go in a `let` after the group.

## Related work

The ideas here are not new one by one, and Quern does not claim they are. Units of measure in a type system are well known from F#. Typing queries for information flow was done in SeLINQ (Schoepe, Hedin and Sabelfeld, ICFP 2014). Encoding grain in types to catch fan traps before running anything is the subject of "Grain-Aware Data Transformations" (Karayannidis, arXiv:2601.00995). What Quern contributes is putting these checks together in one small standalone language with a working compiler, an interpreter, and error messages aimed at the person writing the pipeline.

## Status

Built for the Syntax Summit hackathon. Working today: the compiler, the interpreter, the CLI and the test suite. Planned before the deadline: a browser playground, editor support, and a language reference.

## License

MIT
