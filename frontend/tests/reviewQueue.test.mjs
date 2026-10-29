import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeReviewPage,
  reviewPageOffset,
  selectedReview,
} from "../src/lib/reviewQueue.ts";

function page(ids, offset = 0, total = ids.length, version = "old") {
  return {
    items: ids.map((id) => ({
      id,
      image_url: `${version}/${id}`,
      submitter_name: version,
    })),
    offset,
    total,
    limit: 20,
  };
}

test("polling preserves the chosen review and loaded image while updating queue data", () => {
  const old = page(["a", "b"]);
  const fresh = page(["a", "b", "c"], 0, 3, "fresh");
  const merged = mergeReviewPage(old, fresh, false);
  assert.equal(selectedReview(merged, "b").id, "b");
  assert.equal(selectedReview(merged, "b").image_url, "old/b");
  assert.equal(selectedReview(merged, "b").submitter_name, "fresh");
  assert.equal(selectedReview(merged, "c").image_url, "fresh/c");
  assert.equal(merged.total, 3);
  assert.equal(old.items.length, 2);
});

test("completed competing reviews disappear and selection advances to another pending item", () => {
  const next = mergeReviewPage(
    page(["a", "b"]),
    page(["b"], 0, 1, "fresh"),
    false,
  );
  assert.equal(selectedReview(next, "a").id, "b");
  assert.equal(selectedReview(page([]), "a"), undefined);
  assert.equal(selectedReview(null, "a"), undefined);
});

test("explicit photo refresh and page changes use renewed private image URLs", () => {
  const old = page(["a", "b"]);
  const fresh = page(["a", "b"], 0, 2, "fresh");
  assert.equal(mergeReviewPage(old, fresh, true).items[1].image_url, "fresh/b");
  assert.equal(
    mergeReviewPage(old, page(["b"], 20, 21, "page2"), false).items[0]
      .image_url,
    "page2/b",
  );
  assert.equal(mergeReviewPage(null, fresh, false), fresh);
});

test("pagination reaches all requests and returns to an existing page as the queue shrinks", () => {
  assert.equal(reviewPageOffset(61, 20, 60), 60);
  assert.equal(reviewPageOffset(60, 20, 60), 40);
  assert.equal(reviewPageOffset(20, 20, 20), 0);
  assert.equal(reviewPageOffset(0, 20, 40), 0);
  assert.equal(reviewPageOffset(61, 20, 20), 20);
});
