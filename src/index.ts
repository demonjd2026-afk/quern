// Public API. `compile` is a pure function from source text to diagnostics,
// typed IR and SQL; it touches no files, so it runs the same in Node and in a
// browser.

import { check } from './checker.ts';
import { Diagnostics } from './diagnostics.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { TProgram } from './ir.ts';
import { lex } from './lexer.ts';
import { parse } from './parser.ts';
import { generateSql, generateVerifySql } from './sql.ts';
import type { SqlOptions } from './sql.ts';

export interface CompileResult {
  /** True when there are no errors (warnings do not count). */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Typed IR. Present only when `ok`. */
  program: TProgram | null;
  /** Generated SQL. Present only when `ok`. */
  sql: string | null;
  /** A query that tests the source declarations against the data. Present only when `ok`. */
  verifySql: string | null;
}

export function compile(source: string, options: SqlOptions = {}): CompileResult {
  const diags = new Diagnostics();
  const tokens = lex(source, diags);
  const ast = parse(tokens, diags);
  const program = check(ast, diags);
  const diagnostics = [...diags.items].sort((a, b) => a.span.start - b.span.start);
  if (diags.hasErrors) return { ok: false, diagnostics, program: null, sql: null, verifySql: null };
  return { ok: true, diagnostics, program, sql: generateSql(program, options), verifySql: generateVerifySql(program) };
}

export { CODES, render, positionAt } from './diagnostics.ts';
export type { Diagnostic, Span, Severity } from './diagnostics.ts';
export { run, loadCsv, parseCsv, evaluate, RuntimeError } from './interpreter.ts';
export type { Row, RunOptions } from './interpreter.ts';
export { generateSql, generateStatements, generateVerifySql } from './sql.ts';
export { showType } from './ir.ts';
export type * from './ir.ts';
