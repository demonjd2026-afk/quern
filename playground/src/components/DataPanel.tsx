// The Data tab: the files the program reads, shown as tables and editable as
// CSV text. Readers can change a value, break a declaration on purpose, or add
// a file of their own and have a source declaration drafted for it.

import { useMemo, useState } from 'react';
import { parseCsv } from '../../../src/index.ts';
import { MAX_FILES, MAX_FILE_BYTES, SAMPLE_FILES } from '../lib/build.ts';
import type { Files } from '../lib/build.ts';
import { draftSource } from '../lib/infer.ts';

interface Props {
  files: Files;
  onChange: (files: Files) => void;
  /** Appends text to the program in the editor. */
  onInsert: (text: string) => void;
  /** The open file. Held by the parent so it survives switching tabs. */
  selected: string;
  onSelect: (name: string) => void;
}

const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,58}\.csv$/;
const PREVIEW_ROWS = 40;

export function DataPanel({ files, onChange, onInsert, selected, onSelect: setSelected }: Props) {
  const names = Object.keys(files);
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const current = files[selected] !== undefined ? selected : (names[0] ?? '');
  const text = files[current] ?? '';
  const table = useMemo(() => parseCsv(text), [text]);
  const isSample = current in SAMPLE_FILES;
  const changed = isSample && SAMPLE_FILES[current] !== text;

  const setText = (value: string): void => {
    if (value.length > MAX_FILE_BYTES) {
      setNotice(`A file can hold up to ${MAX_FILE_BYTES / 1000} kB here. The change was not applied.`);
      return;
    }
    setNotice(null);
    onChange({ ...files, [current]: value });
  };

  const addFile = (): void => {
    const name = newName.trim().startsWith('data/') ? newName.trim() : `data/${newName.trim()}`;
    if (!FILE_NAME.test(name)) return setNotice('Name the file with letters, digits, dashes or underscores, ending in .csv. For example: visits.csv');
    if (name in files) return setNotice(`There is already a file called ${name}.`);
    if (names.length >= MAX_FILES) return setNotice(`The playground holds up to ${MAX_FILES} files. Remove one first.`);
    setNotice(null);
    onChange({ ...files, [name]: 'id,name,amount\n1,first,10.5\n2,second,\n' });
    setSelected(name);
    setNewName('');
  };

  const removeFile = (): void => {
    const rest: Record<string, string> = { ...files };
    delete rest[current];
    onChange(rest);
    setSelected(Object.keys(rest)[0] ?? '');
  };

  const insertSource = (): void => {
    const draft = draftSource(current, text);
    if (draft.declaration === null) return setNotice(draft.problem);
    setNotice('A source declaration was added to the end of the program. Write a pipeline that reads from it.');
    onInsert(draft.declaration);
  };

  const header = table[0] ?? [];
  const body = table.slice(1);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div role="group" aria-label="Files" className="flex flex-wrap gap-2">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={name === current}
            onClick={() => {
              setSelected(name);
              setNotice(null);
            }}
            className={`cursor-pointer rounded-full border px-4 py-1.5 font-mono text-[13px] transition-colors ${name === current ? 'border-accent bg-accent/15 text-text' : 'border-line text-mute hover:text-text'}`}
          >
            {name.replace(/^data\//, '')}
            {name in SAMPLE_FILES && SAMPLE_FILES[name] !== files[name] && <span className="ml-2 text-warn">edited</span>}
          </button>
        ))}
      </div>

      {current === '' ? (
        <p className="text-[15px] text-mute">There are no files. Add one below.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[15px] text-mute">
              <span className="font-semibold text-text">{body.length}</span> {body.length === 1 ? 'row' : 'rows'}. Edit the text and the scan reruns. An empty value is null.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={insertSource} className="cursor-pointer rounded-full border border-line bg-raised px-4 py-2 text-[13px] font-semibold text-text transition-colors hover:border-accent active:scale-95">
                Draft a source for this file
              </button>
              {isSample ? (
                <button
                  type="button"
                  disabled={!changed}
                  onClick={() => setText(SAMPLE_FILES[current]!)}
                  className="cursor-pointer rounded-full border border-line bg-raised px-4 py-2 text-[13px] font-semibold text-text transition-colors hover:border-accent active:scale-95 disabled:cursor-default disabled:opacity-40 disabled:hover:border-line"
                >
                  Reset to the sample
                </button>
              ) : (
                <button type="button" onClick={removeFile} className="cursor-pointer rounded-full border border-err/50 bg-raised px-4 py-2 text-[13px] font-semibold text-err transition-colors hover:border-err active:scale-95">
                  Remove this file
                </button>
              )}
            </div>
          </div>

          <label className="sr-only" htmlFor="csv-text">
            CSV text of {current}
          </label>
          <textarea
            id="csv-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="scroll-thin h-36 shrink-0 resize-y rounded-xl border border-line bg-bg/70 p-3.5 font-mono text-[12.5px] leading-relaxed text-text outline-none focus-visible:border-accent"
          />

          <div className="scroll-thin min-h-24 flex-1 overflow-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-left font-mono text-[12.5px]">
              <thead className="sticky top-0">
                <tr className="bg-raised">
                  {header.map((h, i) => (
                    <th key={i} scope="col" className="px-3 py-2 font-medium whitespace-nowrap text-mute">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.slice(0, PREVIEW_ROWS).map((row, r) => (
                  <tr key={r} className="border-t border-line/60">
                    {header.map((_, c) => (
                      <td key={c} className={`px-3 py-1.5 whitespace-nowrap ${row[c] === undefined || row[c] === '' ? 'text-mute italic' : 'text-text'}`}>
                        {row[c] === undefined || row[c] === '' ? 'null' : row[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {body.length > PREVIEW_ROWS && <p className="border-t border-line px-3 py-2 text-[13px] text-mute">Showing the first {PREVIEW_ROWS} of {body.length} rows. All of them are used.</p>}
          </div>
        </>
      )}

      {notice && (
        <p role="status" className="rounded-xl border border-line bg-raised/70 px-4 py-2.5 text-[14px] text-text">
          {notice}
        </p>
      )}

      <form
        className="flex flex-wrap items-center gap-2 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          addFile();
        }}
      >
        <label htmlFor="new-file" className="text-[14px] font-semibold text-text">
          Add your own file
        </label>
        <input
          id="new-file"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="visits.csv"
          maxLength={60}
          className="min-w-0 flex-1 rounded-full border border-line bg-bg/70 px-4 py-2 font-mono text-[13px] text-text outline-none placeholder:text-mute focus-visible:border-accent"
        />
        <button type="submit" className="cursor-pointer rounded-full bg-accent px-5 py-2 text-[13px] font-bold text-bg transition-transform active:scale-95">
          Add file
        </button>
      </form>
    </div>
  );
}
