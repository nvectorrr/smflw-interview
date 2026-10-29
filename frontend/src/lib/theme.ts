export type Theme = "light" | "dark";
export const themeStorageKey = "hdn-theme";
export const themeChangedEvent = "hdn-theme-change";

export function resolveTheme(
  preference: string | null,
  systemDark: boolean,
): Theme {
  return preference === "light" || preference === "dark"
    ? preference
    : systemDark
      ? "dark"
      : "light";
}

export function initializeTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let preference: string | null = null;
  try {
    preference = localStorage.getItem(themeStorageKey);
  } catch {
    /* Device theme works without storage. */
  }
  function apply() {
    const theme = resolveTheme(preference, media.matches);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#151515" : "#f7f7f7");
    window.dispatchEvent(new Event(themeChangedEvent));
  }
  media.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key === themeStorageKey || event.key === null) {
      preference = event.newValue;
      apply();
    }
  });
  window.addEventListener("hdn-theme-select", (event) => {
    preference = (event as CustomEvent<Theme>).detail;
    try {
      localStorage.setItem(themeStorageKey, preference);
    } catch {
      /* Keep the choice for this page. */
    }
    apply();
  });
  apply();
}

export function selectTheme(theme: Theme) {
  window.dispatchEvent(
    new CustomEvent<Theme>("hdn-theme-select", { detail: theme }),
  );
}
