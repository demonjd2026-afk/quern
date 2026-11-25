import { motion } from 'motion/react';
import type { ReactNode } from 'react';

const GUTTER = 'px-5 sm:px-8 xl:px-12 2xl:px-16';

/** Shared frame for the reference tabs: a title, a lead, then sections. */
export function Page({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <motion.div className={`w-full pt-10 pb-8 ${GUTTER}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
      <header className="pt-4 pb-10">
        <h1 className="font-display text-4xl leading-[1.05] font-bold tracking-[-0.03em] sm:text-6xl">{title}</h1>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-mute">{lead}</p>
      </header>
      <div className="grid gap-5">{children}</div>
    </motion.div>
  );
}

/** One titled block inside a page: a framed card, with the heading on the left on wide screens. */
export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="frame grid gap-x-10 gap-y-5 p-6 sm:p-8 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <div>
        <h2 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-tight">
          <span aria-hidden="true" className="h-6 w-1.5 rounded-full bg-accent" />
          {title}
        </h2>
        {note && <p className="mt-3 text-[15px] leading-relaxed text-mute">{note}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A framed block whose title sits above full-width content, with an optional note on the right. */
export function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="frame p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2">
        <h2 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-tight">
          <span aria-hidden="true" className="h-6 w-1.5 rounded-full bg-accent" />
          {title}
        </h2>
        {note && <p className="max-w-2xl text-[15px] leading-relaxed text-mute lg:text-right">{note}</p>}
      </div>
      <div className="mt-7">{children}</div>
    </section>
  );
}

/** A figure with a title and a sentence, used in rows of four. */
export function Figure({ figure, title, children, delay = 0 }: { figure: string; title: string; children: string; delay?: number }) {
  return (
    <motion.div className="frame p-6 sm:p-7" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay }}>
      <p className="font-display text-5xl font-bold tracking-tight text-accent tabular-nums">{figure}</p>
      <h3 className="mt-3 font-display text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-mute">{children}</p>
    </motion.div>
  );
}
