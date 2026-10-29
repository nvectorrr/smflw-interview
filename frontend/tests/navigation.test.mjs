import assert from "node:assert/strict";
import test from "node:test";
import { getTab, getTabUrl } from "../src/lib/navigation.ts";

const base = "https://example.test/";

test("selected tabs survive URL reads and history restoration", () => {
  for (const tab of ["detect", "activity", "review", "team"]) {
    const next = getTabUrl(new URL(base), tab);
    assert.equal(getTab(new URL(next.href)), tab);
  }
  assert.equal(getTab(new URL(base)), "detect");
  assert.equal(getTab(new URL(`${base}?tab=unknown`)), "detect");
});

test("invitations default to Team while explicit navigation takes priority", () => {
  for (const address of [`${base}join/ABC1234`, `${base}?invite=ABC1234`]) {
    const invite = new URL(address);
    assert.equal(getTab(invite), "team");
    assert.equal(getTab(getTabUrl(invite, "detect")), "detect");
  }
});

test("navigation preserves invitation and auth callback data", () => {
  const callback = new URL(
    `${base}join/ABC1234?invite=ABC1234&code=auth-code#access_token=sample&refresh_token=sample`,
  );
  const next = getTabUrl(callback, "activity");
  assert.equal(next.pathname, callback.pathname);
  assert.equal(next.searchParams.get("invite"), "ABC1234");
  assert.equal(next.searchParams.get("code"), "auth-code");
  assert.equal(next.hash, callback.hash);
  assert.equal(callback.searchParams.has("tab"), false);
});
