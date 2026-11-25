// Diagnostics: every problem the compiler reports has a stable code, a source
// span, and (where one exists) a concrete hint on how to fix it.

export interface Span {
  start: number;
  end: number;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  span: Span;
  hint?: string;
}

/** Catalogue of every diagnostic code. test/diagnostics.test.ts requires a test case for each one. */
export const CODES: Readonly<Record<string, string>> = {
  E0001: 'unexpected character',
  E0002: 'unterminated string literal',
  E0003: 'syntax error',
  E0101: 'unknown column',
  E0102: 'unknown source or pipeline',
  E0103: 'type mismatch',
  E0104: 'duplicate or clashing name',
  E0106: 'unknown function or wrong arguments',
  E0107: 'aggregate function outside a group step',
  E0108: 'malformed pipeline',
  E0201: 'nullable value where a non-null value is required',
  E0202: 'aggregate over a nullable column',
  E0203: 'join on a nullable column',
  W0201: 'unnecessary ?? on a non-null value',
  E0300: 'join fans out without `many`',
  E0301: 'additive aggregate over a duplicated column',
  W0300: 'unnecessary `many` on a to-one join',
  E0401: 'PII column published to a public sink',
  E0501: 'unit mismatch',
  E0502: 'invalid unit arithmetic',
  E0601: 'limit without order by',
  E0602: 'order by is not preserved by later steps',
  W0601: 'limit over an order with possible ties',
};

export class Diagnostics {
  readonly items: Diagnostic[] = [];

  error(code: string, span: Span, message: string, hint?: string): void {
    this.push('error', code, span, message, hint);
  }

  warn(code: string, span: Span, message: string, hint?: string): void {
    this.push('warning', code, span, message, hint);
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }

  private push(severity: Severity, code: string, span: Span, message: string, hint?: string): void {
    if (!(code in CODES)) throw new Error(`internal: unregistered diagnostic code ${code}`);
    const d: Diagnostic = { code, severity, message, span };
    if (hint !== undefined) d.hint = hint;
    this.items.push(d);
  }
}

export interface Position {
  line: number; // 1-based
  column: number; // 1-based
}

export function positionAt(source: string, offset: number): Position {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

/** Renders a diagnostic with the offending source line and a caret underline. */
export function render(d: Diagnostic, source: string, file = '<input>'): string {
  const pos = positionAt(source, d.span.start);
  const lines = source.split('\n');
  const text = (lines[pos.line - 1] ?? '').replace(/\r$/, '');
  const gutter = String(pos.line).length;
  const pad = ' '.repeat(gutter);
  const width = Math.max(1, Math.min(d.span.end - d.span.start, text.length - pos.column + 1));
  const out = [
    `${d.severity}[${d.code}]: ${d.message}`,
    `${pad}--> ${file}:${pos.line}:${pos.column}`,
    `${pad} |`,
    `${pos.line} | ${text}`,
    `${pad} | ${' '.repeat(pos.column - 1)}${'^'.repeat(width)}`,
  ];
  if (d.hint !== undefined) out.push(`${pad} = hint: ${d.hint}`);
  return out.join('\n');
}
