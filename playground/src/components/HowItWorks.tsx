// The Internals tab: the compiler drawn as the pipeline it is, with what flows
// along each arrow, and the checks that back up the claims made about it.

import { motion } from 'motion/react';
import { CODES } from '../../../src/index.ts';
import { Page } from './Page.tsx';

interface StageInfo {
  step: string;
  name: string;
  file: string;
  does: string;
}

const STAGES: StageInfo[] = [
  { step: '1', name: 'Lexer', file: 'src/lexer.ts', does: 'Splits the text into tokens: names, numbers, units, dates and symbols.' },
  { step: '2', name: 'Parser', file: 'src/parser.ts', does: 'Builds the syntax tree. After a typo it recovers at the next declaration.' },
  { step: '3', name: 'Checker', file: 'src/checker.ts', does: 'Infers a type for every step and carries nulls, keys, units and PII through.' },
];

const BACK_ENDS: (StageInfo & { produces: string })[] = [
  { step: '4a', name: 'SQL generator', file: 'src/sql.ts', does: 'One view per pipeline, one named step per line you wrote.', produces: 'DuckDB SQL' },
  { step: '4b', name: 'Interpreter', file: 'src/interpreter.ts', does: 'Runs the same checked program directly. It is what executes in this page.', produces: 'Result rows' },
];

/** What travels along each arrow, in order. */
const FLOWS = ['tokens', 'syntax tree'];

function Card({ stage, tone, delay, produces }: { stage: StageInfo; tone: 'accent' | 'info'; delay: number; produces?: string }) {
  const color = tone === 'accent' ? 'text-accent' : 'text-info';
  const edge = tone === 'accent' ? 'border-accent/45' : 'border-info/50';
  return (
    <motion.div
      className={`flex w-full flex-col rounded-2xl border bg-raised/60 p-5 lg:h-[168px] ${edge}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <div className="flex items-center gap-3">
        <span className={`grid h-8 min-w-8 place-items-center rounded-full border px-2 font-display text-sm font-bold ${edge} ${color}`}>{stage.step}</span>
        <h3 className="font-display text-lg font-semibold tracking-tight">{stage.name}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-mute">{stage.does}</p>
      <p className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3 font-mono text-[12px] text-mute">
        {stage.file}
        {produces && <span className={`rounded-full border px-2.5 py-0.5 font-sans text-[12px] font-semibold ${edge} ${color}`}>{produces}</span>}
      </p>
    </motion.div>
  );
}

/** An arrow between two stages, labelled with what flows along it. Points right on wide screens, down on narrow ones. */
function Arrow({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center text-accent lg:w-[92px]">
      <span className="hidden text-[12px] font-semibold text-mute lg:block">{label}</span>
      <svg aria-hidden="true" className="hidden lg:block" width="76" height="20" viewBox="0 0 76 20" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        <path className="flow" d="M2 10h66" />
        <path d="M62 3l9 7-9 7" />
      </svg>
      <div className="flex items-center gap-2 py-1 lg:hidden">
        <svg aria-hidden="true" width="20" height="40" viewBox="0 0 20 40" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path className="flow" d="M10 2v31" />
          <path d="M3 27l7 9 7-9" />
        </svg>
        <span className="text-[12px] font-semibold text-mute">{label}</span>
      </div>
    </div>
  );
}

/**
 * The split after the checker. The geometry matches two 168px cards with a
 * 16px gap, so each branch ends at the middle of the card it points to.
 */
function Fork() {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center text-info">
      <div className="relative hidden h-[352px] w-[124px] lg:block">
        <span className="absolute top-[166px] left-1 w-[58px] -translate-y-full text-center text-[12px] leading-tight font-semibold text-mute">typed program</span>
        <svg aria-hidden="true" width="124" height="352" viewBox="0 0 124 352" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path className="flow" d="M2 176h64" />
          <path className="flow" d="M66 176V100a16 16 0 0 1 16-16h32" />
          <path className="flow" d="M66 176v76a16 16 0 0 0 16 16h32" />
          <path d="M108 77l9 7-9 7" />
          <path d="M108 261l9 7-9 7" />
        </svg>
      </div>
      <div className="flex items-center gap-2 py-1 lg:hidden">
        <svg aria-hidden="true" width="20" height="40" viewBox="0 0 20 40" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path className="flow" d="M10 2v31" />
          <path d="M3 27l7 9 7-9" />
        </svg>
        <span className="text-[12px] font-semibold text-mute">typed program, to both</span>
      </div>
    </div>
  );
}

function Proof({ figure, title, children, delay }: { figure: string; title: string; children: string; delay: number }) {
  return (
    <motion.div className="frame p-6 sm:p-7" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay }}>
      <p className="font-display text-5xl font-bold tracking-tight text-accent tabular-nums">{figure}</p>
      <h3 className="mt-3 font-display text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-mute">{children}</p>
    </motion.div>
  );
}

export function HowItWorks() {
  return (
    <Page title="How it is built" lead="The compiler is plain TypeScript with no runtime dependencies. It has two back ends on purpose: one generates SQL, the other runs the program directly, and the test suite requires them to agree.">
      <section className="frame p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2">
          <h2 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-tight">
            <span aria-hidden="true" className="h-6 w-1.5 rounded-full bg-accent" />
            Compiler stages
          </h2>
          <p className="text-[15px] text-mute">
            <span className="font-mono text-[13px] text-text">program.quern</span> goes in on the left. The checked program goes to both back ends.
          </p>
        </div>

        <div className="mt-8 flex flex-col lg:flex-row lg:items-center">
          {STAGES.map((stage, i) => (
            <div key={stage.name} className="contents">
              <div className="flex min-w-0 flex-1">
                <Card stage={stage} tone="accent" delay={i * 0.1} />
              </div>
              {i < STAGES.length - 1 ? <Arrow label={FLOWS[i]!} /> : <Fork />}
            </div>
          ))}
          <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-[1.15]">
            {BACK_ENDS.map((stage, i) => (
              <Card key={stage.name} stage={stage} tone="info" delay={0.3 + i * 0.1} produces={stage.produces} />
            ))}
          </div>
        </div>
      </section>

      <section aria-label="How the claims are checked" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Proof figure="2" title="Back ends that must agree" delay={0.1}>
          Every test pipeline runs as generated SQL on DuckDB and again in the interpreter. The rows have to match.
        </Proof>
        <Proof figure="40" title="Random data sets" delay={0.18}>
          The comparison runs over the example data and over 40 generated data sets. It caught a real bug: the SQL read CSV columns by position, the interpreter by name.
        </Proof>
        <Proof figure={String(Object.keys(CODES).length)} title="Diagnostics, each with a test" delay={0.26}>
          The test suite fails if any code in the catalogue has no program that triggers it. The Language tab lists them all.
        </Proof>
        <Proof figure="0" title="Network requests" delay={0.34}>
          The compiler, the interpreter and the data are part of this page. A Content Security Policy blocks every outgoing connection.
        </Proof>
      </section>
    </Page>
  );
}
