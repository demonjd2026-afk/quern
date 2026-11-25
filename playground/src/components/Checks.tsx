// The Checks tab. Each check shows a pipeline SQL would run and the corrected
// one. The verdict under each is not written by hand: both snippets are
// compiled when the tab opens and the compiler's own result is shown.

import { motion } from 'motion/react';
import { useMemo } from 'react';
import { compile } from '../../../src/index.ts';
import { SOURCES } from '../lib/examples.ts';
import { Code } from './Code.tsx';
import { Block, Page } from './Page.tsx';

interface Check {
  title: string;
  tone: string;
  body: string;
  wrong: string;
  right: string;
}

const CHECKS: Check[] = [
  {
    title: 'Nulls',
    tone: 'var(--warn)',
    body: 'A value that may be missing has to be dealt with before it is compared, filtered on, joined on or added up.',
    wrong: `pipeline full_price {
  from orders
  where discount = 0 USD
}`,
    right: `pipeline full_price {
  from orders
  where discount ?? 0 USD = 0 USD
}`,
  },
  {
    title: 'Keys and grain',
    tone: 'var(--err)',
    body: 'The compiler knows which columns identify a row, so it knows when a join repeats rows and which sums that would inflate.',
    wrong: `pipeline exposure {
  from orders
  join customers on customer_id = customers.customer_id
  group by region { total = sum(credit_limit) }
}`,
    right: `pipeline exposure {
  from customers
  group by region { total = sum(credit_limit) }
}`,
  },
  {
    title: 'Units',
    tone: 'var(--info)',
    body: 'Numbers carry their unit. Adding or comparing two different units is an error, and so is a bare number where a unit is expected.',
    wrong: `pipeline large_orders {
  from orders
  where amount > 100
}`,
    right: `pipeline large_orders {
  from orders
  where amount > 100 USD
}`,
  },
  {
    title: 'Personal data',
    tone: 'var(--accent)',
    body: 'A column marked pii stays marked through every step. It cannot be published to a public file unless it is hashed first.',
    wrong: `pipeline mailing_list {
  from customers
  select customer_id, email
}
publish mailing_list to public "out/list.csv"`,
    right: `pipeline mailing_list {
  from customers
  select customer_id, contact = hash(email)
}
publish mailing_list to public "out/list.csv"`,
  },
];

const RULES: [string, string, string][] = [
  ['x / y', 'Division by zero gives null', 'So a quotient may be null unless the divisor is a non-zero literal, and the compiler makes you handle it.'],
  ['group { total = sum(x) }', 'A total over a whole table may be null', 'The table could be empty. With group keys every group has at least one row, so the total is never null.'],
  ['order by x limit 10', 'limit needs an order', 'Without one, which rows are kept is arbitrary. The compiler also warns when the order can have ties.'],
];

const LIMITS: [string, string][] = [
  ['Declarations are trusted, then verified', 'The checker reasons from what a source declares. The interpreter rejects a file that breaks a declaration, and quern verify emits SQL that tests the declarations against the data.'],
  ['Personal data follows values', 'It does not track what a filter on a personal column reveals about the rows that remain.'],
  ['Units are single names', 'There are no compound units such as USD per kg.'],
];

function Verdict({ source }: { source: string }) {
  const first = useMemo(() => compile(`${source}\n${SOURCES}`).diagnostics.find((d) => d.severity === 'error') ?? null, [source]);
  if (!first) {
    return (
      <p className="mt-3 flex items-center gap-2.5 text-[14px] font-semibold text-ok">
        <span className="h-2 w-2 rounded-full bg-ok" />
        Type-checks
      </p>
    );
  }
  return (
    <p className="mt-3 flex items-start gap-2.5 text-[14px] leading-snug text-text">
      <span className="mt-0.5 shrink-0 rounded-md border border-err/50 px-2 py-0.5 font-mono text-[12px] font-semibold text-err">{first.code}</span>
      <span>{first.message}</span>
    </p>
  );
}

export function Checks() {
  return (
    <Page title="What the compiler checks" lead="Four facts ride along with every column. You declare them once, where the data comes in. The compiler carries them through every join, filter and aggregate, and stops when a step would break one.">
      <div className="grid gap-5 xl:grid-cols-2">
        {CHECKS.map((c, i) => (
          <motion.section key={c.title} className="frame p-6 sm:p-8" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: i * 0.07 }}>
            <h2 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-tight">
              <span aria-hidden="true" className="h-6 w-1.5 rounded-full" style={{ background: c.tone }} />
              {c.title}
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-mute">{c.body}</p>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="text-[13px] font-semibold text-mute">SQL would run this</h3>
                <Code className="mt-2 border-err/40">{c.wrong}</Code>
                <Verdict source={c.wrong} />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-mute">Quern accepts this</h3>
                <Code className="mt-2 border-ok/40">{c.right}</Code>
                <Verdict source={c.right} />
              </div>
            </div>
          </motion.section>
        ))}
      </div>

      <Block title="Three rules that follow" note="The same idea, applied to cases SQL also gets quietly wrong.">
        <ul className="grid gap-4 lg:grid-cols-3">
          {RULES.map(([code, title, text]) => (
            <li key={title} className="flex flex-col rounded-2xl border border-accent/40 bg-raised/60 p-5">
              <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-mute">{text}</p>
              <Code className="mt-auto !p-3 text-[12.5px]">{code}</Code>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="What it does not claim" note="A checker is only useful if you know where it stops.">
        <ul className="grid gap-4 lg:grid-cols-3">
          {LIMITS.map(([title, text]) => (
            <li key={title} className="rounded-2xl border border-line bg-raised/50 p-5">
              <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-mute">{text}</p>
            </li>
          ))}
        </ul>
      </Block>
    </Page>
  );
}
