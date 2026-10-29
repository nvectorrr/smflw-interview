import assert from "node:assert/strict";
import test from "node:test";
import { resolveTheme } from "../src/lib/theme.ts";

test("device theme is used until a valid manual preference exists", () => {
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme(null, false), "light");
  assert.equal(resolveTheme("invalid", true), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("theme follows device changes, persists manual overrides and syncs between tabs", async () => {
  const { initializeTheme, selectTheme } = await import("../src/lib/theme.ts");
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  };
  const media = Object.assign(new EventTarget(), { matches: true });
  const values = new Map();
  const root = { dataset: {}, style: {} };
  const meta = { setAttribute() {} };
  globalThis.window = Object.assign(new EventTarget(), {
    matchMedia: () => media,
  });
  globalThis.document = { documentElement: root, querySelector: () => meta };
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    initializeTheme();
    assert.equal(root.dataset.theme, "dark");
    media.matches = false;
    media.dispatchEvent(new Event("change"));
    assert.equal(root.dataset.theme, "light");
    selectTheme("dark");
    assert.equal(values.get("hdn-theme"), "dark");
    media.dispatchEvent(new Event("change"));
    assert.equal(root.dataset.theme, "dark");
    window.dispatchEvent(
      Object.assign(new Event("storage"), {
        key: "hdn-theme",
        newValue: "light",
      }),
    );
    assert.equal(root.dataset.theme, "light");
    window.dispatchEvent(
      Object.assign(new Event("storage"), { key: null, newValue: null }),
    );
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    assert.equal(root.dataset.theme, "dark");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
