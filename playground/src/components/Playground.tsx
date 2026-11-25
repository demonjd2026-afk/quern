import { LayoutGroup, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Diagnostic } from '../../../src/index.ts';
import { SAMPLE_FILES } from '../lib/build.ts';
import type { Build, Files } from '../lib/build.ts';
import { DataPanel } from './DataPanel.tsx';
import { CLEAN, EXAMPLES } from '../lib/examples.ts';
import { Editor } from './Editor.tsx';
import type { EditorHandle } from './Editor.tsx';
import { Problems, Result, Sql, Types } from './Panels.tsx';

type Tab = 'problems' | 'sql' | 'result' | 'types' | 'data';
const TABS: { id: Tab; label: string }[] = [
  { id: 'problems', label: 'Findings' },
  { id: 'result', label: 'Result' },
  { id: 'sql', label: 'SQL' },
  { id: 'types', label: 'Types' },
  { id: 'data', label: 'Data' },
];

interface Props {
  source: string;
  build: Build;
  files: Files;
  onChange: (text: string) => void;
  onFiles: (files: Files) => void;
}

export function Playground({ source, build, files, onChange, onFiles }: Props) {
  const editor = useRef<EditorHandle>(null);
  const [exampleId, setExampleId] = useState<string>(EXAMPLES[0]!.id);
  const [tab, setTab] = useState<Tab>('problems');
  const [dataFile, setDataFile] = useState('');
  /** Set when an example or a fix was just loaded, so the panel follows the outcome once. */
  const follow = useRef(false);

  const example = EXAMPLES.find((e) => e.id === exampleId) ?? null;
  const isBroken = example !== null && source === example.broken;
  const isFixed = example !== null && source === example.fixed;

  const load = (text: string): void => {
    follow.current = true;
    editor.current?.replace(text);
  };

  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    setTab(build.blocked ? 'problems' : 'result');
  }, [build]);

  // Anything the reader has changed: the code of the first example, or any data file.
  const pristine = source === EXAMPLES[0]!.broken && files === SAMPLE_FILES;
  const reset = (): void => {
    onFiles(SAMPLE_FILES);
    setDataFile('');
    setExampleId(EXAMPLES[0]!.id);
    // Not load(): that would let the panel follow the intermediate build made from the old code.
    follow.current = false;
    editor.current?.replace(EXAMPLES[0]!.broken);
    setTab('problems');
  };

  const reveal = (d: Diagnostic): void => editor.current?.reveal(d.span.start, d.span.end);

  return (
    <section aria-label="Scan console" className="w-full px-5 sm:px-8 xl:px-12 2xl:px-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-2 border-t-2 border-line pt-10">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Scan console</h2>
        <p className="max-w-xl text-[15px] leading-relaxed text-mute">Each button loads a pipeline that SQL would run without complaint. Edit the code, or the data in the Data tab, and Quern rescans as you type.</p>
      </div>
      <LayoutGroup id="examples">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div role="group" aria-label="Examples" className="flex flex-wrap items-center gap-2">
          {EXAMPLES.map((e) => (
            <ExampleButton
              key={e.id}
              active={exampleId === e.id}
              label={e.label}
              onClick={() => {
                setExampleId(e.id);
                load(e.broken);
              }}
            />
          ))}
          <ExampleButton
            active={exampleId === 'clean'}
            label="A correct program"
            onClick={() => {
              setExampleId('clean');
              load(CLEAN);
            }}
          />
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={pristine}
          title="Restore the first example and all sample data"
          className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-panel/70 px-5 py-2.5 text-[15px] font-semibold text-text backdrop-blur-xl transition-colors hover:border-accent active:scale-95 disabled:cursor-default disabled:opacity-40 disabled:hover:border-line"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
            <path d="M3 4.5v4.6h4.6" />
          </svg>
          Reset console
        </button>
        </div>
      </LayoutGroup>

      <div className="mt-4 flex min-h-[3.5rem] flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="max-w-3xl text-base leading-relaxed text-mute">
          {example ? (
            <>
              <span className="font-semibold text-text">What SQL does:</span> {example.inSql}
            </>
          ) : (
            'Three pipelines over a small shop. Break one: delete the ?? default, or sum a column from the other side of a join.'
          )}
        </p>
        {example && (isBroken || isFixed) && (
          <motion.button
            type="button"
            layout
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => load(isBroken ? example.fixed : example.broken)}
            className={`cursor-pointer rounded-full px-7 py-3 text-[15px] font-bold text-bg shadow-[0_0_30px_-8px_currentColor] transition-colors ${isBroken ? 'bg-ok' : 'bg-err'}`}
          >
            {isBroken ? 'Apply the fix' : 'Break it again'}
          </motion.button>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:h-[min(720px,calc(100vh-9rem))] lg:min-h-[500px] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div data-state={build.blocked ? 'err' : 'ok'} className="frame flex h-[420px] min-h-0 flex-col overflow-hidden lg:h-auto">
          <span key={build.millis} className="scan-beam" aria-hidden="true" />
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <span className="flex items-center gap-2.5 text-sm font-semibold text-text"><span className={`h-2 w-2 rounded-full ${build.blocked ? 'bg-err' : 'bg-ok'}`} />program.quern</span>
            <span className="hidden text-[13px] text-mute sm:inline">Scanned in {build.millis < 1 ? 'under 1' : Math.round(build.millis)} ms, in this tab</span>
          </div>
          <div className="min-h-0 flex-1">
            <Editor ref={editor} initial={source} diagnostics={build.result.diagnostics} onChange={onChange} />
          </div>
        </div>

        <div data-state={build.blocked ? 'err' : 'ok'} className="frame flex h-[460px] min-h-0 flex-col overflow-hidden lg:h-auto">
          <LayoutGroup id="tabs">
            <div role="tablist" aria-label="Compiler output" className="flex gap-1 border-b border-line px-3 py-2">
              {TABS.map((t) => {
                const selected = tab === t.id;
                const count = t.id === 'problems' ? build.findings : 0;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    type="button"
                    aria-selected={selected}
                    aria-controls="panel"
                    onClick={() => setTab(t.id)}
                    className={`relative cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition-colors ${selected ? 'text-text' : 'text-mute hover:text-text'}`}
                  >
                    {selected && <motion.span layoutId="tab" className="absolute inset-0 rounded-full bg-raised" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                    <span className="relative flex items-center gap-2">
                      {t.label}
                      {count > 0 && (
                        <span className={`rounded-full px-2 text-xs font-bold text-bg ${build.blocked ? 'bg-err' : 'bg-warn'}`}>{count}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
          <div id="panel" role="tabpanel" className="scroll-thin min-h-0 flex-1 overflow-auto">
            {tab === 'problems' && <Problems build={build} source={source} onReveal={reveal} onOpenData={() => setTab('data')} />}
            {tab === 'sql' && <Sql build={build} />}
            {tab === 'result' && <Result build={build} />}
            {tab === 'types' && <Types build={build} />}
            {tab === 'data' && <DataPanel files={files} onChange={onFiles} onInsert={(text) => editor.current?.append(text)} selected={dataFile} onSelect={setDataFile} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function ExampleButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`relative cursor-pointer rounded-full border px-5 py-2.5 text-[15px] font-semibold transition-colors ${active ? 'border-transparent text-bg' : 'border-line bg-panel/70 text-text backdrop-blur-xl hover:border-accent'}`}
    >
      {active && <motion.span layoutId="example" className="absolute inset-0 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
      <span className="relative">{label}</span>
    </button>
  );
}
