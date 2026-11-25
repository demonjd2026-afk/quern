// The Language tab: the whole language on one page. Counts are taken from the
// lists rendered below them, and the diagnostics from the compiler's own
// catalogue, so the page cannot describe something that is not there.

import { CODES } from '../../../src/index.ts';
import { Code, Term } from './Code.tsx';
import { Block, Figure, Page } from './Page.tsx';

const PROGRAM = `source orders from "data/orders.csv" {
  order_id:    int key,
  customer_id: int,
  amount:      float<USD>,
  discount:    float<USD>?,
  email:       text pii,
}

pipeline big_orders {
  from orders
  where amount > 500 USD
  let net = amount - discount ?? 0 USD
}

publish big_orders to restricted "out/big_orders.csv"`;

const DECLARATIONS: [string, string, string][] = [
  ['source', 'Where data comes in', 'Names a CSV file and declares each column once: its type, whether it can be null, its unit, whether it is a key, whether it is personal data. Sources can sit anywhere in the file.'],
  ['pipeline', 'What to do with it', 'A from, then steps read top to bottom. A pipeline can read a source or an earlier pipeline, and must be defined before another one reads it.'],
  ['publish', 'Where results go', 'Writes a pipeline to a file, marked public or restricted. A public file cannot contain personal data.'],
];

const TYPES: [string, string][] = [
  ['int  float  text  bool  date', 'The five base types.'],
  ['float<USD>   int<g>', 'A unit of measure, on int and float. Any name works as a unit.'],
  ['float?', 'May be null. Without the question mark it never is.'],
  ['key', 'Identifies a row. Use key (a, b) for a key made of several columns.'],
  ['pii', 'Personal data. The mark follows the value through every step.'],
];

const STEPS: [string, string, string][] = [
  ['from', 'from orders', 'Starts from a source or an earlier pipeline. Always first.'],
  ['join', 'join customers on customer_id = customers.customer_id', 'Brings in another relation. Add left to keep unmatched rows, and many if a row can match more than one.'],
  ['where', 'where shipped and amount > 50 USD', 'Keeps the rows where the condition is true. where x is not null also makes x non-null afterwards.'],
  ['let', 'let net = amount - discount ?? 0 USD', 'Adds a column. It never overwrites one.'],
  ['select', 'select order_id, contact = hash(email)', 'Keeps only the listed columns, with optional renames.'],
  ['group', 'group by region { revenue = sum(net) }', 'One row per group. With no by, one row for the whole table.'],
  ['order by', 'order by revenue desc, region', 'Sorts. It must be the last step, or come directly before limit.'],
  ['limit', 'limit 10', 'Keeps the first n rows. Needs an order by directly before it.'],
];

/** Loosest first. */
const OPERATORS: [string, string][] = [
  ['or', 'Both sides are bool and never null.'],
  ['and', 'Both sides are bool and never null.'],
  ['not', 'The operand is bool and never null.'],
  ['=  !=  <  <=  >  >=    is null    is not null', 'Comparisons need non-null values in the same unit. is null is how a nullable value is tested.'],
  ['+   -', 'Both sides are in the same unit.'],
  ['*   /', 'At most one side of * has a unit. Division by zero gives null, so a quotient may be null.'],
  ['??', 'Uses the right side when the left is null.'],
  ['-x', 'Negation.'],
];

const LITERALS: [string, string][] = [
  ['42    3.5', 'int and float'],
  ['100 USD    250 g', 'a number with its unit, on one line'],
  ['"South"', 'text'],
  ['true    false', 'bool'],
  ['@2026-10-01', 'date'],
];

const SCALARS: [string, string][] = [
  ['hash(x)', 'A one-way hash of text or int. The only function that clears the pii mark.'],
  ['lower(x)', 'Text in lower case.'],
  ['upper(x)', 'Text in upper case.'],
  ['abs(x)', 'Absolute value. Keeps the unit.'],
  ['round(x, 2)', 'Rounds to a fixed number of decimal places.'],
  ['convert(x, INR, 83.2)', 'x multiplied by the rate, in the new unit.'],
];

const AGGREGATES: [string, string][] = [
  ['sum(x)', 'Rejected over a nullable value, and over rows a join has repeated.'],
  ['avg(x)', 'The same two rules as sum.'],
  ['min(x)', 'Smallest value. Rejected over a nullable value.'],
  ['max(x)', 'Largest value. Rejected over a nullable value.'],
  ['count()', 'The number of rows in the group.'],
  ['count_distinct(x)', 'The number of different values. Its result is not personal data.'],
];

const FAMILIES: [prefix: string, name: string][] = [
  ['E00', 'Syntax'],
  ['E01', 'Names and types'],
  ['02', 'Nulls'],
  ['03', 'Keys and grain'],
  ['E04', 'Personal data'],
  ['E05', 'Units'],
  ['06', 'Ordering'],
];

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <ul className="grid gap-2.5">
      {rows.map(([term, meaning]) => (
        <li key={term} className="grid items-center gap-x-5 gap-y-1.5 rounded-xl border border-line bg-raised/50 px-4 py-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <span>
            <Term>{term}</Term>
          </span>
          <span className="text-[15px] leading-relaxed text-mute">{meaning}</span>
        </li>
      ))}
    </ul>
  );
}

export function Language() {
  const codes = Object.entries(CODES);
  return (
    <Page title="The language" lead="A Quern program is a list of sources, pipelines and publishes. A pipeline is a from followed by steps, read top to bottom. That is the whole language, and this page lists every part of it.">
      <section aria-label="The language in numbers" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Figure figure={String(DECLARATIONS.length)} title="Kinds of declaration" delay={0.05}>
          source, pipeline and publish. A file is a list of these and nothing else.
        </Figure>
        <Figure figure={String(STEPS.length)} title="Pipeline steps" delay={0.12}>
          Each one takes the rows from the step above it and hands its result to the step below.
        </Figure>
        <Figure figure={String(SCALARS.length + AGGREGATES.length)} title="Built-in functions" delay={0.19}>
          {`${SCALARS.length} that work on a value and ${AGGREGATES.length} aggregates. There are no user-defined functions to learn.`}
        </Figure>
        <Figure figure={String(codes.length)} title="Diagnostics" delay={0.26}>
          Every message the compiler can give is listed at the end of this page, with its code.
        </Figure>
      </section>

      <Block title="A program at a glance" note="Three kinds of declaration make up every program.">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Code className="h-full">{PROGRAM}</Code>
          <ol className="grid content-start gap-3">
            {DECLARATIONS.map(([keyword, title, text]) => (
              <li key={keyword} className="rounded-2xl border border-accent/40 bg-raised/60 p-5">
                <p className="flex flex-wrap items-center gap-3">
                  <Term>{keyword}</Term>
                  <span className="font-display text-lg font-semibold tracking-tight">{title}</span>
                </p>
                <p className="mt-2.5 text-[15px] leading-relaxed text-mute">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </Block>

      <Block title="Column types" note="A column type is a base type plus the facts the compiler tracks about it.">
        <Rows rows={TYPES} />
      </Block>

      <Block title="Pipeline steps" note="Written one per line, in the order they run.">
        <ol className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {STEPS.map(([keyword, example, text], i) => (
            <li key={keyword} className="flex flex-col rounded-2xl border border-accent/40 bg-raised/60 p-5">
              <p className="flex items-center gap-3">
                <span className="grid h-8 min-w-8 place-items-center rounded-full border border-accent/45 px-2 font-display text-sm font-bold text-accent">{i + 1}</span>
                <span className="font-display text-lg font-semibold tracking-tight">{keyword}</span>
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-mute">{text}</p>
              <Code className="mt-auto !p-3 text-[12.5px]">{example}</Code>
            </li>
          ))}
        </ol>
      </Block>

      <Block title="Expressions" note="?? binds tighter than arithmetic, so amount - discount ?? 0 USD subtracts the defaulted discount.">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight">Operators, loosest to tightest</h3>
            <ol className="mt-4 grid gap-2.5">
              {OPERATORS.map(([term, meaning], i) => (
                <li key={term} className="grid items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-raised/50 px-4 py-3 sm:grid-cols-[2rem_minmax(0,17rem)_minmax(0,1fr)]">
                  <span className="font-display text-sm font-bold text-accent">{i + 1}</span>
                  <span>
                    <Term>{term}</Term>
                  </span>
                  <span className="text-[15px] leading-relaxed text-mute">{meaning}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight">Literals</h3>
            <div className="mt-4">
              <Rows rows={LITERALS} />
            </div>
          </div>
        </div>
      </Block>

      <Block title="Functions" note="Aggregates are only allowed as the outputs of a group step.">
        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight">On a value</h3>
            <div className="mt-4">
              <Rows rows={SCALARS} />
            </div>
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight">Over a group</h3>
            <div className="mt-4">
              <Rows rows={AGGREGATES} />
            </div>
          </div>
        </div>
      </Block>

      <Block title="Diagnostics" note={`All ${codes.length} codes the compiler can report. Codes starting with W are warnings and do not stop the compile.`}>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {FAMILIES.map(([prefix, name]) => {
            const members = codes.filter(([code]) => code.includes(prefix) && code.indexOf(prefix) <= 1);
            return (
              <div key={name} className="rounded-2xl border border-line bg-raised/50 p-5">
                <h3 className="flex items-baseline justify-between gap-3 font-display text-lg font-semibold tracking-tight">
                  {name}
                  <span className="text-[13px] font-medium text-mute">{members.length}</span>
                </h3>
                <ul className="mt-3 grid gap-2.5">
                  {members.map(([code, text]) => (
                    <li key={code} className="flex items-start gap-3 text-[14px] leading-snug">
                      <span className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-[12px] font-semibold ${code.startsWith('W') ? 'border-warn/50 text-warn' : 'border-err/50 text-err'}`}>{code}</span>
                      <span className="pt-0.5 text-mute">{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Block>
    </Page>
  );
}
