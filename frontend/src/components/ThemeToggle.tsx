import { useSyncExternalStore } from "react";
import { selectTheme, themeChangedEvent } from "../lib/theme";

function subscribe(notify: () => void) {
  window.addEventListener(themeChangedEvent, notify);
  return () => window.removeEventListener(themeChangedEvent, notify);
}
const snapshot = () => document.documentElement.dataset.theme === "dark";

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, snapshot);
  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => selectTheme(dark ? "light" : "dark")}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </svg>
      <span className="theme-switch-track" aria-hidden="true">
        <span />
      </span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M20 15.5A9 9 0 0 1 8.5 4a9 9 0 1 0 11.5 11.5Z" />
      </svg>
    </button>
  );
}
