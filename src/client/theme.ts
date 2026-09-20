import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'free-subs-theme';

/** Reads the operating system preference, defaulting to dark when unknown. */
export function systemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

export interface ThemeController {
  theme: Theme;
  toggle: () => void;
}

/**
 * Theme controller: follows the system until the user picks explicitly, then
 * persists the choice in `localStorage['free-subs-theme']`.
 */
export function useTheme(): ThemeController {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? systemTheme());
  const [explicit, setExplicit] = useState<boolean>(() => readStoredTheme() !== null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // While the user has not chosen, keep following the OS preference live.
  useEffect(() => {
    if (explicit || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handle = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? 'dark' : 'light');
    };
    query.addEventListener('change', handle);
    return () => {
      query.removeEventListener('change', handle);
    };
  }, [explicit]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Persistence is best-effort (private mode, quota, ...).
      }
      return next;
    });
    setExplicit(true);
  }, []);

  return { theme, toggle };
}
