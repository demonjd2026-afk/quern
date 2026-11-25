import { useEffect, useState } from 'react';

export const VIEWS = [
  { id: 'playground', label: 'Playground' },
  { id: 'language', label: 'Language' },
  { id: 'checks', label: 'Checks' },
  { id: 'internals', label: 'Internals' },
] as const;

export type View = (typeof VIEWS)[number]['id'];

function fromHash(): View {
  const id = window.location.hash.slice(1);
  return VIEWS.some((v) => v.id === id) ? (id as View) : 'playground';
}

/** The current tab, kept in the URL hash so each one can be linked to. */
export function useView(): View {
  const [view, setView] = useState<View>(fromHash);
  useEffect(() => {
    const onChange = (): void => {
      setView(fromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return view;
}
