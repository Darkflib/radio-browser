/**
 * Theme module — light / dark mode.
 *
 * The initial theme is applied by a tiny inline script in index.html (before
 * first paint) to avoid a flash of the wrong theme. This module keeps that
 * choice in sync at runtime: it exposes the current theme, toggles it, persists
 * the user's explicit choice, and follows the OS preference until then.
 */

const THEME_KEY = 'radio_browser_theme';

const listeners = new Set();

/** Does the OS currently prefer a dark colour scheme? */
function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** The theme actually applied to the document ('dark' | 'light'). */
export function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light';
}

export function isDark() {
  return getTheme() === 'dark';
}

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  listeners.forEach(fn => fn(theme));
}

/** Explicitly set and persist a theme. */
export function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* best-effort */ }
  apply(next);
}

/** Flip between light and dark, persisting the choice. */
export function toggleTheme() {
  setTheme(isDark() ? 'light' : 'dark');
}

/**
 * Subscribe to theme changes. Returns an unsubscribe function.
 */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Keep following the OS preference until the user makes an explicit choice.
 * (Once they've toggled, their stored choice wins and we ignore OS changes.)
 */
export function initTheme() {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', e => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
    if (saved !== 'dark' && saved !== 'light') {
      apply(e.matches ? 'dark' : 'light');
    }
  });
}
