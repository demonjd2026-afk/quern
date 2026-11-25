import type { Diagnostics } from './diagnostics.ts';

export type TokenKind = 'ident' | 'keyword' | 'int' | 'float' | 'string' | 'date' | 'symbol' | 'eof';

export interface Token {
  kind: TokenKind;
  text: string; // for strings: the unescaped value
  start: number;
  end: number;
  line: number;
}

export const KEYWORDS: ReadonlySet<string> = new Set([
  'source', 'from', 'pipeline', 'publish', 'to', 'public', 'restricted',
  'join', 'left', 'many', 'on', 'where', 'let', 'select', 'group', 'by',
  'order', 'asc', 'desc', 'limit', 'and', 'or', 'not', 'is', 'null',
  'true', 'false', 'key', 'pii',
]);

const SYMBOLS = ['??', '!=', '<=', '>=', '{', '}', '(', ')', ',', ':', '.', '=', '<', '>', '+', '-', '*', '/', '?'];

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

export function lex(source: string, diags: Diagnostics): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  while (i < n) {
    const c = source[i]!;

    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    // `--` starts a comment that runs to the end of the line.
    if (c === '-' && source[i + 1] === '-') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    const start = i;

    if (isIdentStart(c)) {
      while (i < n && isIdentPart(source[i]!)) i++;
      const text = source.slice(start, i);
      tokens.push({ kind: KEYWORDS.has(text) ? 'keyword' : 'ident', text, start, end: i, line });
      continue;
    }

    if (isDigit(c)) {
      while (i < n && isDigit(source[i]!)) i++;
      let kind: TokenKind = 'int';
      if (source[i] === '.' && i + 1 < n && isDigit(source[i + 1]!)) {
        kind = 'float';
        i++;
        while (i < n && isDigit(source[i]!)) i++;
      }
      tokens.push({ kind, text: source.slice(start, i), start, end: i, line });
      continue;
    }

    // Date literal: @2026-01-31
    if (c === '@') {
      const m = /^@(\d{4}-\d{2}-\d{2})/.exec(source.slice(i, i + 11));
      if (m && isValidDate(m[1]!)) {
        i += 11;
        tokens.push({ kind: 'date', text: m[1]!, start, end: i, line });
      } else {
        diags.error('E0001', { start, end: start + 1 }, 'invalid date literal', 'dates are written @YYYY-MM-DD, for example @2026-01-31');
        i++;
      }
      continue;
    }

    if (c === '"') {
      i++;
      let value = '';
      let closed = false;
      while (i < n && source[i] !== '\n') {
        const ch = source[i]!;
        if (ch === '"') {
          closed = true;
          i++;
          break;
        }
        if (ch === '\\' && i + 1 < n && (source[i + 1] === '"' || source[i + 1] === '\\')) {
          value += source[i + 1];
          i += 2;
          continue;
        }
        value += ch;
        i++;
      }
      if (!closed) {
        diags.error('E0002', { start, end: i }, 'unterminated string literal', 'add a closing " on the same line');
      }
      tokens.push({ kind: 'string', text: value, start, end: i, line });
      continue;
    }

    const sym = SYMBOLS.find((s) => source.startsWith(s, i));
    if (sym !== undefined) {
      i += sym.length;
      tokens.push({ kind: 'symbol', text: sym, start, end: i, line });
      continue;
    }

    diags.error('E0001', { start, end: start + 1 }, `unexpected character '${c}'`);
    i++;
  }

  tokens.push({ kind: 'eof', text: '', start: n, end: n, line });
  return tokens;
}

export function isValidDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[mo - 1]!;
}
