import type { ReviewPage } from "./api";

export function reviewPageOffset(total: number, limit: number, offset: number) {
  return Math.min(offset, Math.max(0, Math.ceil(total / limit) - 1) * limit);
}

export function selectedReview(page: ReviewPage | null, selectedId: string) {
  return page?.items.find((item) => item.id === selectedId) ?? page?.items[0];
}

export function mergeReviewPage(
  previous: ReviewPage | null,
  next: ReviewPage,
  renewImages: boolean,
): ReviewPage {
  if (renewImages || !previous || previous.offset !== next.offset) return next;
  const images = new Map(
    previous.items.map((item) => [item.id, item.image_url]),
  );
  return {
    ...next,
    // Polls refresh queue membership without reloading the photo being inspected.
    items: next.items.map((item) => ({
      ...item,
      image_url: images.get(item.id) ?? item.image_url,
    })),
  };
}
