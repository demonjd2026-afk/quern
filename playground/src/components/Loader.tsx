import { AnimatePresence, motion } from 'motion/react';
import { Millstone } from './Millstone.tsx';

/** Covers the page until the fonts and the first compile are ready. */
export function Loader({ ready }: { ready: boolean }) {
  return (
    <AnimatePresence>
      {!ready && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-bg"
          exit={{ opacity: 0, transition: { duration: 0.45, ease: 'easeOut' } }}
          role="status"
          aria-label="Loading the compiler"
        >
          <div className="flex flex-col items-center gap-4">
            <div style={{ animation: 'spin-slow 1.6s linear infinite' }}>
              <Millstone turns={0} size={56} />
            </div>
            <p className="text-sm font-semibold text-mute">Starting the compiler</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
