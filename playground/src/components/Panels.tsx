import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { Diagnostic, Relation, Row, TProgram } from '../../../src/index.ts';
import { positionAt } from '../../../src/index.ts';
import type { Build } from '../lib/build.ts';

// ---- Problems ----

export function Problems({ build, source, onReveal, onOpenData }: { build: Build; source: string; onReveal: (d: Diagnostic) => void; onOpenData: () => void }) {
  const { diagnostics } = build.result;
  if (build.dataError && diagnostics.every((d) => d.severity !== 'error')) {
    // The program is well typed, but a file does not keep a promise its source declaration makes.
    return (
      <div className="p-4">
        <div className="relative overflow-hidden rounded-2xl border border-err/40 bg-raised/70 p-5 pl-6">
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-err" />
          <p className="flex items-center gap-3">
            <span className="rounded-full bg-err px-3 py-1 text-xs font-bold text-bg">Data</span>
            <span className="font-mono text-[13px] text-mute">{build.dataError.code}</span>
          </p>
          <p className="mt-3 text-base leading-snug font-semibold text-text">{build.dataError.message}</p>
          <p className="mt-4 rounded-xl border border-line bg-bg/60 p-3.5 text-[15px] leading-relaxed text-mute">
            <span className="font-semibold text-ok">How to fix it.</span> The program type-checks, but the data breaks what a source declares. Correct the file, or change the declaration to match it (for example, mark the column with ? if it can be empty).
          </p>
          <button type="button" onClick={onOpenData} className="mt-4 cursor-pointer rounded-full bg-accent px-5 py-2 text-[13px] font-bold text-bg transition-transform active:scale-95">
            Open the Data tab
          </button>
        </div>
      </div>
    );
  }
  if (diagnostics.length === 0) {
    const pipelines = build.result.program?.items.filter((i) => i.kind === 'pipeline').length ?? 0;
    return (
      <div className="flex h-full flex-col items-start justify-center gap-2 p-8">
        <p className="font-display text-2xl font-semibold text-ok">Scan clean.</p>
        <p className="max-w-sm text-[15px] leading-relaxed text-mute">
          {pipelines === 1 ? 'The pipeline type-checks' : `All ${pipelines} pipelines type-check`}. Open Result to see the rows, or SQL to see what was generated.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3 p-4">
      <AnimatePresence initial={false} mode="popLayout">
        {diagnostics.map((d, i) => {
          const pos = positionAt(source, d.span.start);
          const isError = d.severity === 'error';
          return (
            <motion.li
              key={`${d.code}:${d.span.start}:${i}`}
              layout
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0, transition: { delay: i * 0.05, duration: 0.25 } }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
            >
              <button
                type="button"
                onClick={() => onReveal(d)}
                className={`group relative w-full cursor-pointer overflow-hidden rounded-2xl border bg-raised/70 p-5 pl-6 text-left transition-colors hover:bg-raised ${isError ? 'border-err/40' : 'border-warn/40'}`}
              >
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${isError ? 'bg-err' : 'bg-warn'}`} />
                <span className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold text-bg ${isError ? 'bg-err' : 'bg-warn'}`}>{isError ? 'Error' : 'Warning'}</span>
                    <span className="font-mono text-[13px] text-mute">{d.code}</span>
                  </span>
                  <span className="text-[13px] text-mute group-hover:text-text">
                    Line {pos.line}, column {pos.column}
                  </span>
                </span>
                <span className="mt-3 block text-base leading-snug font-semibold text-text">{d.message}</span>
                {d.hint && (
                  <span className="mt-4 block rounded-xl border border-line bg-bg/60 p-3.5 text-[15px] leading-relaxed text-mute">
                    <span className="font-semibold text-ok">How to fix it.</span> {d.hint}
                  </span>
                )}
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

// ---- SQL ----

const SQL_WORDS = /^(CREATE|OR|REPLACE|VIEW|AS|WITH|SELECT|FROM|WHERE|GROUP|BY|ORDER|LIMIT|JOIN|LEFT|ON|AND|NOT|CAST|COALESCE|NULLIF|NULLS|LAST|DESC|ASC|COUNT|SUM|AVG|MIN|MAX|DISTINCT|COPY|TO|FORMAT|IS|NULL|TRUE|FALSE|DATE|BIGINT|DOUBLE|VARCHAR|BOOLEAN|CSV|HEADER)$/;

function highlightSql(sql: string): { text: string; className: string }[] {
  const out: { text: string; className: string }[] = [];
  const pattern = /("(?:[^"]|"")*")|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/g;
  for (const m of sql.matchAll(pattern)) {
    if (m[1]) out.push({ text: m[1], className: 'text-text' });
    else if (m[2]) out.push({ text: m[2], className: 'text-[var(--syn-string)]' });
    else if (m[3]) out.push({ text: m[3], className: 'text-[var(--syn-number)]' });
    else if (m[4]) out.push({ text: m[4], className: SQL_WORDS.test(m[4]) ? 'text-[var(--syn-keyword)]' : 'text-[var(--syn-function)]' });
    else out.push({ text: m[5]!, className: 'text-mute' });
  }
  return out;
}

export function Sql({ build }: { build: Build }) {
  const [copied, setCopied] = useState(false);
  const sql = build.result.sql;
  if (sql === null) return <Blocked what="SQL" />;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="relative h-full">
      <button
        type="button"
        onClick={copy}
        className="absolute top-3 right-4 z-10 cursor-pointer rounded-full border border-line bg-raised px-4 py-2 text-[13px] font-semibold text-text transition-transform hover:border-accent active:scale-95"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={copied ? 'done' : 'copy'} className="block" initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -6, opacity: 0 }} transition={{ duration: 0.12 }}>
            {copied ? 'Copied' : 'Copy SQL'}
          </motion.span>
        </AnimatePresence>
      </button>
      <pre className="scroll-thin h-full overflow-auto p-4 pr-28 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
        <code>
          {highlightSql(sql).map((tok, i) => (
            <span key={i} className={tok.className}>
              {tok.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

// ---- Result ----

function relationOf(program: TProgram, name: string): Relation | null {
  const item = program.items.find((i) => i.kind === 'pipeline' && i.name === name);
  return item && item.kind === 'pipeline' ? item.relation : null;
}

function cell(value: Row[string]): string {
  if (value === null) return 'null';
  if (typeof value === 'number' && !Number.isInteger(value)) return String(Math.round(value * 10000) / 10000);
  return String(value);
}

export function Result({ build }: { build: Build }) {
  const program = build.result.program;
  if (!program) return <Blocked what="rows" />;
  if (build.dataError !== null || !build.tables) return <Blocked what="rows" />;
  const names = program.items.flatMap((i) => (i.kind === 'pipeline' ? [i.name] : []));
  return (
    <div className="scroll-thin flex h-full flex-col gap-6 overflow-auto p-4">
      {names.map((name) => {
        const rows = build.tables!.get(name) ?? [];
        const rel = relationOf(program, name)!;
        return (
          <section key={name}>
            <h3 className="mb-2.5 flex items-baseline gap-3 font-mono text-sm font-semibold text-text">
              {name}
              <span className="text-xs text-mute">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'}
              </span>
            </h3>
            <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-left font-mono text-[12.5px]">
                <thead>
                  <tr className="bg-raised">
                    {rel.columns.map((c) => (
                      <th key={c.name} scope="col" className="px-3 py-2 font-medium whitespace-nowrap text-mute">
                        {c.name}
                        {c.type.unit && <span className="ml-1.5 text-info">{c.type.unit}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, r) => (
                    <motion.tr key={r} className="border-t border-line/60" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: Math.min(r, 12) * 0.03 } }}>
                      {rel.columns.map((c) => (
                        <td key={c.name} className={`px-3 py-1.5 whitespace-nowrap ${row[c.name] === null ? 'text-mute italic' : c.type.base === 'int' || c.type.base === 'float' ? 'text-right text-text tabular-nums' : 'text-text'}`}>
                          {cell(row[c.name] ?? null)}
                        </td>
                      ))}
                    </motion.tr>
                  ))}
                  {rows.length === 0 && (
                    <tr className="border-t border-line/60">
                      <td colSpan={rel.columns.length} className="px-3 py-2 text-mute">
                        no rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---- Types ----

function Chip({ children, tone }: { children: string; tone: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone}`}>{children}</span>;
}

export function Types({ build }: { build: Build }) {
  const program = build.result.program;
  if (!program) return <Blocked what="types" />;
  const items = program.items.filter((i) => i.kind !== 'publish');
  // Pipelines first: they are what the reader just wrote.
  const ordered = [...items.filter((i) => i.kind === 'pipeline'), ...items.filter((i) => i.kind === 'source')];
  return (
    <div className="scroll-thin flex h-full flex-col gap-5 overflow-auto p-4">
      {ordered.map((item) => (
        <section key={item.name}>
          <h3 className="mb-2 flex flex-wrap items-baseline gap-x-3 font-mono text-sm text-text">
            <span>
              <span className="text-ok">{item.kind}</span> {item.name}
            </span>
            <span className="text-xs text-mute">
              {item.relation.keys.length === 0 ? 'no key' : `one row per ${item.relation.keys.map((k) => (k.length === 0 ? 'table' : k.join(' + '))).join(', or per ')}`}
            </span>
          </h3>
          <ul className="grid gap-1 font-mono text-[12.5px]">
            {item.relation.columns.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center gap-2 rounded-lg bg-raised/70 px-3.5 py-2">
                <span className="min-w-28 text-text">{c.name}</span>
                <span className="text-[var(--syn-type)]">{c.type.base}</span>
                {c.type.unit && <Chip tone="bg-info/15 text-info">{c.type.unit}</Chip>}
                {c.type.nullable && <Chip tone="bg-warn/15 text-warn">may be null</Chip>}
                {c.type.pii && <Chip tone="bg-err/15 text-err">pii</Chip>}
                {c.duplicated && <Chip tone="bg-line/60 text-mute">repeated by a join</Chip>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Blocked({ what }: { what: string }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 p-8">
      <p className="font-display text-2xl font-semibold text-err">Nothing to show yet.</p>
      <p className="max-w-sm text-[15px] leading-relaxed text-mute">Quern produces no {what} until the scan is clean. Open Findings to see what to fix.</p>
    </div>
  );
}
