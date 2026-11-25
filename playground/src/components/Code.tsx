// Static syntax highlighting for the Quern snippets shown in the reference
// tabs. Colours come from the same CSS variables as the editor.

import { KEYWORDS } from '../../../src/lexer.ts';

const TYPES = new Set(['int', 'float', 'text', 'bool', 'date']);
const MODIFIERS = new Set(['key', 'pii', 'many', 'public', 'restricted']);
const PATTERN = /(--[^\n]*)|("(?:[^"\\\n]|\\.)*")|(@\d{4}-\d{2}-\d{2})|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\n)|([ \t]+)|(.)/g;

interface Piece {
  text: string;
  color: string | null;
  italic?: boolean;
}

function pieces(source: string): Piece[] {
  const out: Piece[] = [];
  let afterNumber: boolean = false;
  for (const m of source.matchAll(PATTERN)) {
    const wasNumber: boolean = afterNumber;
    // A unit follows its number across spaces, but not across a line break.
    afterNumber = m[7] !== undefined ? wasNumber : false;
    if (m[1] !== undefined) out.push({ text: m[1], color: 'var(--syn-comment)', italic: true });
    else if (m[2] !== undefined) out.push({ text: m[2], color: 'var(--syn-string)' });
    else if (m[3] !== undefined) out.push({ text: m[3], color: 'var(--syn-number)' });
    else if (m[4] !== undefined) {
      out.push({ text: m[4], color: 'var(--syn-number)' });
      afterNumber = true;
    } else if (m[5] !== undefined) {
      const word = m[5];
      const next = source[(m.index ?? 0) + word.length];
      let color: string | null = null;
      if (MODIFIERS.has(word)) color = 'var(--syn-modifier)';
      else if (KEYWORDS.has(word)) color = 'var(--syn-keyword)';
      else if (TYPES.has(word)) color = 'var(--syn-type)';
      else if (wasNumber) color = 'var(--syn-number)';
      else if (next === '(') color = 'var(--syn-function)';
      out.push({ text: word, color });
    } else out.push({ text: m[0], color: m[8] !== undefined ? 'var(--mute)' : null });
  }
  return out;
}

/** Highlighted Quern, inline. Wrap it in <Code> for a block. */
export function Quern({ children }: { children: string }) {
  return (
    <>
      {pieces(children).map((p, i) =>
        p.color === null ? (
          p.text
        ) : (
          <span key={i} style={{ color: p.color, fontStyle: p.italic ? 'italic' : undefined }}>
            {p.text}
          </span>
        ),
      )}
    </>
  );
}

export function Code({ children, className = '' }: { children: string; className?: string }) {
  return (
    <pre className={`scroll-thin overflow-x-auto rounded-xl border border-line bg-bg/70 p-4 font-mono text-[13px] leading-[1.7] text-text ${className}`}>
      <code>
        <Quern>{children}</Quern>
      </code>
    </pre>
  );
}

/** A short piece of syntax set inline as a pill. */
export function Term({ children }: { children: string }) {
  return (
    <code className="inline-block rounded-lg border border-line bg-bg/70 px-2.5 py-1 font-mono text-[13px] leading-snug text-text">
      <Quern>{children}</Quern>
    </code>
  );
}
