import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import type { Diagnostic } from '../../../src/index.ts';
import { quernLanguage } from '../lib/quern-language.ts';

export interface EditorHandle {
  /** Replaces the text, changing only the part that differs, and flashes it. */
  replace: (text: string) => void;
  /** Adds text at the end of the program, flashes it and scrolls to it. */
  append: (text: string) => void;
  /** Moves the cursor to a source span and scrolls it into view. */
  reveal: (start: number, end: number) => void;
}

const flash = StateEffect.define<{ from: number; to: number } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flash)) next = e.value && e.value.to > e.value.from ? Decoration.set([Decoration.mark({ class: 'cm-flash' }).range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Scrolls the editor's own pane, never the page, so the layout does not jump. */
function centre(view: EditorView, pos: number): void {
  const block = view.lineBlockAt(pos);
  view.scrollDOM.scrollTo({ top: Math.max(0, block.top - view.scrollDOM.clientHeight / 2 + block.height) });
}

interface Props {
  initial: string;
  diagnostics: Diagnostic[];
  onChange: (text: string) => void;
  ref: Ref<EditorHandle>;
}

export function Editor({ initial, diagnostics, onChange, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          bracketMatching(),
          indentUnit.of('  '),
          lintGutter(),
          flashField,
          quernLanguage,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': 'Quern program', spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changed.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor owns its text after mount; `initial` is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const length = v.state.doc.length;
    const mapped: CmDiagnostic[] = diagnostics.map((d) => {
      const from = Math.min(d.span.start, length);
      const to = Math.min(Math.max(d.span.end, from + 1), length);
      return {
        from: Math.min(from, to),
        to,
        severity: d.severity,
        message: d.hint ? `${d.message}\n\nFix: ${d.hint}` : d.message,
        source: d.code,
      };
    });
    v.dispatch(setDiagnostics(v.state, mapped));
  }, [diagnostics]);

  useImperativeHandle(ref, () => ({
    replace(text) {
      const v = view.current;
      if (!v) return;
      const old = v.state.doc.toString();
      let start = 0;
      while (start < old.length && start < text.length && old[start] === text[start]) start++;
      let endOld = old.length;
      let endNew = text.length;
      while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) {
        endOld--;
        endNew--;
      }
      v.dispatch({
        changes: { from: start, to: endOld, insert: text.slice(start, endNew) },
        effects: flash.of({ from: start, to: endNew }),
        selection: { anchor: start },
      });
      centre(v, start);
      window.setTimeout(() => view.current?.dispatch({ effects: flash.of(null) }), 1500);
    },
    append(text) {
      const v = view.current;
      if (!v) return;
      const at = v.state.doc.length;
      const insert = (at > 0 && !v.state.doc.toString().endsWith('\n') ? '\n' : '') + text;
      v.dispatch({ changes: { from: at, insert }, effects: flash.of({ from: at, to: at + insert.length }), selection: { anchor: at + insert.length } });
      centre(v, at + insert.length);
      window.setTimeout(() => view.current?.dispatch({ effects: flash.of(null) }), 1500);
    },
    reveal(start, end) {
      const v = view.current;
      if (!v) return;
      const to = Math.min(end, v.state.doc.length);
      v.dispatch({ selection: { anchor: Math.min(start, to), head: to } });
      centre(v, Math.min(start, to));
      v.contentDOM.focus({ preventScroll: true });
    },
  }));

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
