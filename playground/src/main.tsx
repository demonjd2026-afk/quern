import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyTheme, initialTheme } from './lib/theme.ts';
import './styles.css';

// Set the theme before the first paint so the page never flashes the wrong one.
applyTheme(initialTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
