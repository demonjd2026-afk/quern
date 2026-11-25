#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compile, render, run, RuntimeError, showType } from './index.ts';
import type { Row, TProgram } from './index.ts';

const USAGE = `quern - a typed data-pipeline language where data bugs are compile errors

usage:
  quern check   <file.quern>                 type-check and report diagnostics
  quern compile <file.quern> [-o out.sql]    emit DuckDB SQL
  quern verify  <file.quern>                 emit SQL that tests source declarations against the data
  quern run     <file.quern> [pipeline]      execute with the reference interpreter and print rows
  quern types   <file.quern>                 print the inferred type of every pipeline
`;

function main(argv: string[]): number {
  const [command, file, ...rest] = argv;
  if (!command || !file || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    process.stderr.write(`quern: cannot read ${file}\n`);
    return 2;
  }
  const base = dirname(resolve(file));
  const result = compile(source, { resolvePath: (p) => resolve(base, p) });
  for (const d of result.diagnostics) process.stderr.write(render(d, source, file) + '\n\n');
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = result.diagnostics.length - errors;
  if (!result.ok || !result.program || result.sql === null || result.verifySql === null) {
    process.stderr.write(`${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}\n`);
    return 1;
  }

  switch (command) {
    case 'check':
      process.stdout.write(`ok: ${file} (${warnings} warning${warnings === 1 ? '' : 's'})\n`);
      return 0;
    case 'compile': {
      const o = rest.indexOf('-o');
      const outFile = o >= 0 ? rest[o + 1] : undefined;
      if (outFile) writeFileSync(outFile, result.sql);
      else process.stdout.write(result.sql);
      return 0;
    }
    case 'verify':
      process.stdout.write(result.verifySql);
      return 0;
    case 'types':
      process.stdout.write(describe(result.program));
      return 0;
    case 'run': {
      try {
        const tables = run(result.program, { readSource: (p) => readFileSync(resolve(base, p), 'utf8') });
        const wanted = rest[0];
        const names = result.program.items.flatMap((i) => (i.kind === 'pipeline' && (!wanted || i.name === wanted) ? [i.name] : []));
        if (names.length === 0) {
          process.stderr.write(`quern: no pipeline named '${wanted}'\n`);
          return 2;
        }
        for (const name of names) process.stdout.write(`${name}\n${table(tables.get(name)!)}\n`);
        return 0;
      } catch (e) {
        if (e instanceof RuntimeError) {
          process.stderr.write(`error[${e.code}]: ${e.message}\n`);
          return 1;
        }
        throw e;
      }
    }
    default:
      process.stderr.write(`quern: unknown command '${command}'\n\n${USAGE}`);
      return 2;
  }
}

function describe(program: TProgram): string {
  let out = '';
  for (const item of program.items) {
    if (item.kind === 'publish') continue;
    out += `${item.kind} ${item.name}\n`;
    for (const c of item.relation.columns) out += `  ${c.name}: ${showType(c.type)}${c.duplicated ? '  (duplicated by a join)' : ''}\n`;
    const keys = item.relation.keys.map((k) => `(${k.join(', ')})`).join(', ');
    out += `  keys: ${keys || 'none'}\n\n`;
  }
  return out;
}

function table(rows: Row[]): string {
  if (rows.length === 0) return '  (no rows)\n';
  const cols = Object.keys(rows[0]!);
  const cells = rows.map((r) => cols.map((c) => (r[c] === null ? 'null' : String(r[c]))));
  const widths = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i]!.length)));
  const line = (values: string[]): string => '  ' + values.map((v, i) => v.padEnd(widths[i]!)).join('  ').trimEnd() + '\n';
  return line(cols) + line(widths.map((w) => '-'.repeat(w))) + cells.map(line).join('');
}

process.exitCode = main(process.argv.slice(2));
