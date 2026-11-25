// CodeMirror support for Quern: a stream tokenizer for highlighting, and the
// editor theme. Keywords come from the compiler's own list so they cannot drift.

import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { KEYWORDS } from '../../../src/lexer.ts';

const TYPES = new Set(['int', 'float', 'text', 'bool', 'date']);
const FUNCTIONS = new Set(['sum', 'avg', 'min', 'max', 'count', 'count_distinct', 'hash', 'lower', 'upper', 'abs', 'round', 'convert']);
const MODIFIERS = new Set(['key', 'pii', 'many', 'public', 'restricted']);
const ATOMS = new Set(['true', 'false', 'null']);

const quern = StreamLanguage.define<{ afterNumber: boolean }>({
  name: 'quern',
  startState: () => ({ afterNumber: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    const wasNumber = state.afterNumber;
    state.afterNumber = false;
    if (stream.match('--')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"(?:[^"\\\n]|\\.)*"?/)) return 'string';
    if (stream.match(/^@\d{4}-\d{2}-\d{2}/)) return 'literal';
    if (stream.match(/^\d+(?:\.\d+)?/)) {
      state.afterNumber = true;
      return 'number';
    }
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      if (ATOMS.has(w)) return 'atom';
      if (MODIFIERS.has(w)) return 'modifier';
      if (KEYWORDS.has(w)) return 'keyword';
      if (TYPES.has(w)) return 'typeName';
      if (wasNumber) return 'unit';
      if (FUNCTIONS.has(w) && stream.peek() === '(') return 'function';
      return 'variableName';
    }
    if (stream.match('??') || stream.match(/^[=!<>]=?/) || stream.match(/^[+\-*/?]/)) return 'operator';
    stream.next();
    return null;
  },
  tokenTable: { unit: t.unit, function: t.function(t.variableName), modifier: t.modifier, literal: t.literal },
});

// Colours are CSS variables, so the editor follows the page theme.
const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: t.modifier, color: 'var(--syn-modifier)' },
  { tag: t.typeName, color: 'var(--syn-type)' },
  { tag: [t.unit, t.literal, t.number, t.atom], color: 'var(--syn-number)' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.function(t.variableName), color: 'var(--syn-function)' },
  { tag: t.operator, color: 'var(--mute)' },
  { tag: t.variableName, color: 'var(--text)' },
]);

const theme = EditorView.theme({
  '&': { color: 'var(--text)' },
  '.cm-content': { padding: '14px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'color-mix(in oklab, var(--accent) 22%, transparent)' },
  '.cm-activeLine': { background: 'color-mix(in oklab, var(--text) 5%, transparent)' },
  '.cm-gutters': { background: 'transparent', color: 'var(--mute)', border: 'none', opacity: '0.75' },
  '.cm-activeLineGutter': { background: 'transparent', color: 'var(--text)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '34px' },
  '.cm-diagnostic': { fontFamily: 'var(--font-sans)', fontSize: '13px', padding: '6px 10px', borderLeft: 'none', whiteSpace: 'pre-wrap' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--err)' },
  '.cm-diagnostic-warning': { borderLeft: '3px solid var(--warn)' },
  '.cm-tooltip': { background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text)', overflow: 'hidden', maxWidth: '420px' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--err)', textDecorationSkipInk: 'none', textUnderlineOffset: '4px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)', textDecorationSkipInk: 'none', textUnderlineOffset: '4px' },
  '.cm-lint-marker-error': { content: 'none', width: '8px', height: '8px', borderRadius: '1px', background: 'var(--err)', boxShadow: '0 0 10px 1px color-mix(in oklab, var(--err) 60%, transparent)', marginTop: '7px' },
  '.cm-lint-marker-warning': { content: 'none', width: '8px', height: '8px', borderRadius: '1px', background: 'var(--warn)', marginTop: '7px' },
  '.cm-gutter-lint': { width: '14px' },
});

export const quernLanguage: Extension = [quern, syntaxHighlighting(highlight), theme];
