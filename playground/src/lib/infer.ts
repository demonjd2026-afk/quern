// Drafts a `source` declaration from a CSV file's header and values, so a
// reader who pastes their own data has something to start from. It is a guess
// from the rows it can see, and the generated comment says so.

import { parseCsv } from '../../../src/index.ts';
import { KEYWORDS, isValidDate } from '../../../src/lexer.ts';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function guessType(values: string[]): string {
  const present = values.filter((v) => v !== '');
  if (present.length === 0) return 'text';
  if (present.every((v) => /^-?\d+$/.test(v) && Number.isSafeInteger(Number(v)))) return 'int';
  if (present.every((v) => /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v))) return 'float';
  if (present.every((v) => v === 'true' || v === 'false')) return 'bool';
  if (present.every(isValidDate)) return 'date';
  return 'text';
}

export interface Draft {
  /** The declaration text, or null when the file cannot be described. */
  declaration: string | null;
  /** Why not, in the reader's terms. */
  problem: string | null;
}

export function draftSource(path: string, csv: string): Draft {
  const rows = parseCsv(csv);
  const header = rows[0];
  if (!header || header.length === 0) return { declaration: null, problem: 'The file is empty. Its first line must name the columns.' };
  const bad = header.find((name) => !IDENTIFIER.test(name) || KEYWORDS.has(name));
  if (bad !== undefined) {
    return { declaration: null, problem: `Column "${bad}" cannot be used as a name. Use letters, digits and underscores, and avoid Quern keywords.` };
  }
  if (new Set(header).size !== header.length) return { declaration: null, problem: 'Two columns have the same name.' };

  const body = rows.slice(1);
  const stem = (path.split('/').pop() ?? 'data').replace(/\.csv$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
  let name = IDENTIFIER.test(stem) ? stem : `t_${stem}`;
  if (KEYWORDS.has(name)) name = `${name}_data`;

  const width = Math.max(...header.map((h) => h.length)) + 1;
  let keyed = false;
  const lines = header.map((column, i) => {
    const values = body.map((row) => row[i] ?? '');
    const type = guessType(values);
    const nullable = values.some((v) => v === '');
    // The first column that is complete and never repeats is offered as the key.
    const unique = !nullable && values.length > 0 && new Set(values).size === values.length;
    const key = !keyed && unique && (type === 'int' || type === 'text');
    if (key) keyed = true;
    return `  ${`${column}:`.padEnd(width + 1)}${type}${nullable ? '?' : ''}${key ? ' key' : ''},`;
  });
  return {
    declaration: `\n-- Drafted from ${body.length} ${body.length === 1 ? 'row' : 'rows'} of ${path}. Check the types, keys and units.\nsource ${name} from "${path}" {\n${lines.join('\n')}\n}\n`,
    problem: null,
  };
}
