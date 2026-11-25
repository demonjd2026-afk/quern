// The mark: a quern is a pair of millstones. It turns once each time the
// compiler runs.

import { motion } from 'motion/react';

export function Millstone({ turns, size = 28 }: { turns: number; size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      animate={{ rotate: turns * 90 }}
      transition={{ type: 'spring', stiffness: 120, damping: 18 }}
    >
      <circle cx="16" cy="16" r="12" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="2.6" fill="var(--accent)" />
      <path d="M16 4.5v6M16 21.5v6M4.5 16h6M21.5 16h6" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
    </motion.svg>
  );
}
