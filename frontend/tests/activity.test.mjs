import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Exercise the real JSX without starting a browser or connecting to Supabase.
test("activity reserves its registry during loading and scopes review actions", async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), "activity-render-"));
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    cacheDir,
    configFile: false,
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        "https://example.supabase.co",
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":
        JSON.stringify("test-key"),
    },
    esbuild: { jsx: "automatic" },
  });
  const previousWindow = globalThis.window;
  t.after(async () => {
    globalThis.window = previousWindow;
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  });
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const { ActivityPanel, ActivityBootstrap } = await server.ssrLoadModule(
    "/src/components/ActivityPanel.tsx",
  );
  const { ActivityRecords } = await server.ssrLoadModule(
    "/src/components/activity/ActivityRecords.tsx",
  );
  const render = (component, props = {}) =>
    renderToStaticMarkup(createElement(component, props));
  const noop = () => {};
  const initial = render(ActivityPanel, {
    active: true,
    revision: 0,
    team: null,
    members: [],
    userId: "owner",
    onClassify: noop,
    onOpenTeam: noop,
  });
  for (const html of [initial, render(ActivityBootstrap)]) {
    assert.match(html, /class="stats-grid"/);
    assert.match(html, /class="registry-table"/);
    assert.match(html, /class="record-inspector activity-inspector-skeleton"/);
    assert.match(html, /Loading activity/);
  }
  const record = {
    id: "check-1",
    image_name: "Lunch",
    file_name: "lunch.jpg",
    image_sha256: "a".repeat(64),
    model: "haiku",
    model_id: "haiku",
    is_hot_dog: true,
    cached: false,
    created_at: "2026-10-29T12:00:00Z",
    certificate_id: "certificate-1",
    size_bytes: 100,
    content_type: "image/jpeg",
    user_id: "owner",
    team_id: null,
    review: null,
  };
  const props = {
    active: true,
    page: { items: [record], total: 1, limit: 20, offset: 0 },
    loading: false,
    offset: 0,
    selectedId: record.id,
    teamView: false,
    team: null,
    userId: "owner",
    onSelect: noop,
    onOffsetChange: noop,
    onReviewRequested: noop,
    onOpenTeam: noop,
  };
  const personal = render(ActivityRecords, props);
  assert.match(personal, /aria-haspopup="dialog"/);
  assert.match(personal, /Request human review/);
  const otherTeam = render(ActivityRecords, {
    ...props,
    team: { id: "team-2", name: "Second team", role: "user" },
  });
  assert.doesNotMatch(otherTeam, /Join or create a team|Request human review/);
  const teamRecord = render(ActivityRecords, {
    ...props,
    team: { id: "team-1", name: "Team", role: "user" },
    page: { ...props.page, items: [{ ...record, team_id: "team-1" }] },
  });
  assert.match(teamRecord, /Request human review/);
  assert.doesNotMatch(teamRecord, /aria-haspopup="dialog"/);
  await t.test(
    "review queue keeps the same frame through bootstrap, empty, error and decisions",
    async () => {
      const { ReviewDeskBootstrap, ReviewDeskView } =
        await server.ssrLoadModule("/src/components/ReviewDesk.tsx");
      const item = {
        ...record,
        image_url: "https://example.com/image.jpg",
        original_is_hot_dog: true,
        submitter_name: "Reviewer",
      };
      const baseQueue = {
        page: { items: [], total: 0, limit: 20, offset: 0 },
        item: undefined,
        offset: 0,
        loading: false,
        refreshing: false,
        busy: false,
        error: "",
        lastDecision: null,
        refresh: async () => {},
        decide: async () => {},
        select: noop,
        changePage: noop,
      };
      const states = [
        render(ReviewDeskBootstrap),
        render(ReviewDeskView, { queue: baseQueue }),
        render(ReviewDeskView, {
          queue: { ...baseQueue, error: "Could not retrieve requests." },
        }),
        render(ReviewDeskView, {
          queue: {
            ...baseQueue,
            page: { ...baseQueue.page, items: [item], total: 1 },
            item,
          },
        }),
        render(ReviewDeskView, {
          queue: { ...baseQueue, lastDecision: { is_hot_dog: true } },
        }),
      ];
      for (const html of states) {
        for (const slot of [
          "review-toolbar",
          "review-feedback",
          "review-stage",
          "review-pagination",
        ]) {
          assert.match(html, new RegExp(`class="[^"\n]*${slot}`));
        }
        assert.equal((html.match(/class="review-stage"/g) ?? []).length, 1);
      }
      assert.match(states[1], /All caught up/);
      assert.match(states[3], /class="review-card"/);
      assert.match(states[4], /Decision saved/);
    },
  );
});
