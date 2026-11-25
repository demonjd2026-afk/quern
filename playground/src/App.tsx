import { LayoutGroup, motion, useScroll, useTransform } from 'motion/react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Checks } from './components/Checks.tsx';
import { HowItWorks } from './components/HowItWorks.tsx';
import { Language } from './components/Language.tsx';
import { Loader } from './components/Loader.tsx';
import { Millstone } from './components/Millstone.tsx';
import { Playground } from './components/Playground.tsx';
import { SAMPLE_FILES, build } from './lib/build.ts';
import type { Files } from './lib/build.ts';
import { EXAMPLES } from './lib/examples.ts';
import { useTheme } from './lib/theme.ts';
import { VIEWS, useView } from './lib/view.ts';

// three.js is only needed for the hero scene, so it loads as its own chunk.
const Scene3D = lazy(() => import('./components/Scene3D.tsx'));

const REPO = 'https://github.com/demonjd2026-afk/quern';
const GUTTER = 'px-5 sm:px-8 xl:px-12 2xl:px-16';
const HEADLINE = ['Data bugs are', 'compile errors.'];

/** The mark, the name and the tagline, as one unit. */
function Brand({ turns }: { turns: number }) {
  return (
    <span className="flex items-center gap-3.5">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line bg-panel shadow-[0_0_28px_-6px_var(--accent)]">
        <Millstone turns={turns} size={30} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.65rem] font-bold tracking-tight">Quern</span>
        <span className="mt-1.5 hidden text-[13px] font-medium text-mute sm:block">Typed pipelines that compile to SQL</span>
      </span>
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="frame px-5 py-4">
      <p className="text-[13px] font-medium text-mute">{label}</p>
      <motion.p key={value} className={`mt-1 font-display text-3xl font-semibold tabular-nums ${tone}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {value}
      </motion.p>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <a href={href} className="block rounded-full border border-line px-4 py-2 text-text transition-colors hover:border-accent hover:text-accent">
        {children}
      </a>
    </li>
  );
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {dark ? (
        <>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" />
        </>
      ) : (
        <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function App() {
  const [source, setSource] = useState(EXAMPLES[0]!.broken);
  const [checked, setChecked] = useState(source);
  const [files, setFiles] = useState<Files>(SAMPLE_FILES);
  const [ready, setReady] = useState(false);
  const [turns, setTurns] = useState(0);
  const [theme, toggleTheme] = useTheme();
  const view = useView();

  // Type-check a moment after the last keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setChecked(source), 120);
    return () => window.clearTimeout(timer);
  }, [source]);

  const result = useMemo(() => build(checked, files), [checked, files]);
  useEffect(() => setTurns((n) => n + 1), [result]);

  // The page's ambient light follows the scan result.
  useEffect(() => {
    document.documentElement.style.setProperty('--status', result.blocked ? 'var(--err)' : 'var(--ok)');
  }, [result.blocked]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([document.fonts.ready, new Promise((r) => window.setTimeout(r, 450))]).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { scrollY } = useScroll();
  const navSolid = useTransform(scrollY, [0, 80], [0, 1]);
  const sceneY = useTransform(scrollY, [0, 600], [0, 70]);

  const failing = result.blocked;
  const pipelines = result.result.program?.items.filter((i) => i.kind === 'pipeline').length ?? 0;
  const rows = result.tables && result.result.program ? result.result.program.items.reduce((n, i) => (i.kind === 'pipeline' ? n + (result.tables!.get(i.name)?.length ?? 0) : n), 0) : 0;
  const statusTone = failing ? 'text-err' : result.warnings > 0 ? 'text-warn' : 'text-ok';

  return (
    <>
      <Loader ready={ready} />

      <header className="sticky top-0 z-30">
        {/* Always a distinct bar with its own edge; it turns fully opaque once the page scrolls under it. */}
        <div aria-hidden="true" className="absolute inset-0 border-b-2 border-line bg-panel/85 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.6)] backdrop-blur-xl" />
        <motion.div aria-hidden="true" className="absolute inset-0 border-b-2 border-line bg-panel" style={{ opacity: navSolid }} />
        <nav aria-label="Main" className={`relative flex w-full items-center justify-between gap-4 py-4 ${GUTTER}`}>
          <a href="#playground" aria-label="Quern, typed pipelines that compile to SQL" className="rounded-2xl">
            <Brand turns={turns} />
          </a>

          <LayoutGroup id="views">
            <div role="tablist" aria-label="Sections" className="hidden items-center gap-1 rounded-full border border-line bg-panel/70 p-1.5 backdrop-blur-xl lg:flex">
              {VIEWS.map((v) => (
                <a
                  key={v.id}
                  href={`#${v.id}`}
                  role="tab"
                  aria-selected={view === v.id}
                  className={`relative rounded-full px-5 py-2 text-[15px] font-semibold transition-colors ${view === v.id ? 'text-bg' : 'text-mute hover:text-text'}`}
                >
                  {view === v.id && <motion.span layoutId="view" className="absolute inset-0 rounded-full bg-text" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                  <span className="relative">{v.label}</span>
                </a>
              ))}
            </div>
          </LayoutGroup>

          <div className="flex items-center gap-2.5">
            <span aria-live="polite" className={`hidden items-center gap-2 rounded-full border border-line bg-panel/70 px-4 py-2 text-sm font-semibold whitespace-nowrap backdrop-blur-xl sm:flex ${statusTone}`}>
              <span className={`h-2 w-2 rounded-full ${failing ? 'bg-err' : result.warnings > 0 ? 'bg-warn' : 'bg-ok'} shadow-[0_0_10px_currentColor]`} />
              {failing ? `${result.findings} ${result.findings === 1 ? 'finding' : 'findings'}` : result.warnings > 0 ? `${result.warnings} ${result.warnings === 1 ? 'warning' : 'warnings'}` : 'Scan clean'}
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-line bg-panel/70 text-text backdrop-blur-xl transition-colors hover:border-accent active:scale-95"
            >
              <ThemeIcon dark={theme === 'dark'} />
            </button>
            <a href={REPO} className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-bg transition-transform hover:-translate-y-0.5 active:scale-95">
              GitHub
            </a>
          </div>
        </nav>
        <div role="tablist" aria-label="Sections" className={`scroll-thin relative flex gap-1.5 overflow-x-auto border-b-2 border-line bg-panel pb-3 lg:hidden ${GUTTER}`}>
          {VIEWS.map((v) => (
            <a key={v.id} href={`#${v.id}`} role="tab" aria-selected={view === v.id} className={`rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap ${view === v.id ? 'bg-text text-bg' : 'border border-line text-mute'}`}>
              {v.label}
            </a>
          ))}
        </div>
      </header>

      <main>
        {/* The playground stays mounted while other tabs are open, so the editor keeps its text. */}
        <div hidden={view !== 'playground'}>
          <section className={`relative grid w-full items-center gap-8 pt-10 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pt-12 ${GUTTER}`}>
            <div className="relative z-10">
              <h1 className="font-display text-[clamp(2.6rem,5.2vw,5.4rem)] leading-[1.03] font-bold tracking-[-0.035em]" aria-label={HEADLINE.join(' ')}>
                {HEADLINE.map((line, i) => (
                  <span key={line} aria-hidden="true" className="block overflow-hidden pb-[0.08em]">
                    <motion.span className="block" initial={{ y: '105%' }} animate={ready ? { y: 0 } : { y: '105%' }} transition={{ duration: 0.8, delay: 0.1 + i * 0.1, ease: [0.2, 0.8, 0.2, 1] }}>
                      {line}
                    </motion.span>
                  </span>
                ))}
              </h1>
              <motion.p className="mt-6 max-w-xl text-lg leading-[1.65] text-mute" initial={{ opacity: 0 }} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: 0.6, delay: 0.45 }}>
                Quern is a small typed language for data pipelines. It scans every step before any data runs, compiles to SQL, and refuses to compile the mistakes SQL runs without a word.
              </motion.p>
              <motion.div className="mt-8 flex flex-wrap gap-3" initial={{ opacity: 0, y: 10 }} animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ duration: 0.5, delay: 0.55 }}>
                <a href="#console" className="rounded-full bg-text px-7 py-3.5 text-[15px] font-bold text-bg transition-transform hover:-translate-y-0.5 active:scale-95">
                  Open the scan console
                </a>
                <a href="#language" className="rounded-full border border-line bg-panel/70 px-7 py-3.5 text-[15px] font-bold text-text backdrop-blur-xl transition-colors hover:border-accent">
                  Read the language
                </a>
              </motion.div>
              <motion.div className="mt-10 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4" initial={{ opacity: 0, y: 14 }} animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }} transition={{ duration: 0.5, delay: 0.7 }}>
                <Stat label="Scan result" value={failing ? 'Blocked' : 'Clean'} tone={failing ? 'text-err' : 'text-ok'} />
                <Stat label="Findings" value={String(result.findings)} tone={statusTone} />
                <Stat label={failing ? 'Pipelines passing' : 'Pipelines'} value={String(result.tables ? pipelines : 0)} tone="text-text" />
                <Stat label="Rows produced" value={String(rows)} tone="text-text" />
              </motion.div>
            </div>

            <motion.div
              className="relative hidden h-[clamp(420px,62vh,680px)] lg:block"
              style={{ y: sceneY }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={ready ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
              transition={{ duration: 1.1, delay: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {view === 'playground' && (
                <Suspense fallback={null}>
                  <Scene3D errors={failing ? 1 : 0} theme={theme} />
                </Suspense>
              )}
              <div className="pointer-events-none absolute top-6 right-0 text-right">
                <p className={`font-display text-lg font-semibold transition-colors duration-500 ${failing ? 'text-err' : 'text-ok'}`}>{failing ? 'Input rejected' : 'Grain in, rows out'}</p>
                <p className="mt-1 text-[13px] text-mute">{failing ? 'The stones will not grind a program with a bug.' : 'Unordered data enters; ordered rows leave.'}</p>
              </div>
              <p className="pointer-events-none absolute right-0 bottom-3 text-[13px] text-mute">Drag to turn</p>
            </motion.div>
          </section>

          <motion.div id="console" initial={{ opacity: 0, y: 24 }} animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }} transition={{ duration: 0.6, delay: 0.85 }}>
            <Playground source={source} build={result} files={files} onChange={setSource} onFiles={setFiles} />
          </motion.div>
        </div>
        {view === 'language' && <Language />}
        {view === 'checks' && <Checks />}
        {view === 'internals' && <HowItWorks />}
      </main>

      <footer className="mt-20 border-t-2 border-line bg-panel">
        <div className={`flex w-full flex-wrap items-center justify-between gap-x-10 gap-y-5 py-7 ${GUTTER}`}>
          <p className="text-[15px] text-text">
            Built by <span className="font-semibold">Jayanth Dolai</span> for the{' '}
            <a href="https://syntax-summit.devpost.com/" className="rounded font-semibold underline decoration-line underline-offset-4 transition-colors hover:text-accent hover:decoration-accent">
              Syntax Summit hackathon
            </a>
          </p>
          <ul className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm font-semibold">
            <FooterLink href={REPO}>Source on GitHub</FooterLink>
            <FooterLink href={`${REPO}#readme`}>README</FooterLink>
            <FooterLink href={`${REPO}/blob/main/LICENSE`}>MIT license</FooterLink>
            <FooterLink href="https://www.linkedin.com/in/jayanth-dolai-7b115213a/">LinkedIn</FooterLink>
          </ul>
        </div>
        <div className="border-t border-line">
          <div className={`flex w-full flex-wrap items-center justify-between gap-x-8 gap-y-2 py-4 text-[13px] text-mute ${GUTTER}`}>
            <p>No network requests. The compiler, the interpreter and the data run in your browser.</p>
            <p>Version 0.1.0</p>
          </div>
        </div>
      </footer>
    </>
  );
}
