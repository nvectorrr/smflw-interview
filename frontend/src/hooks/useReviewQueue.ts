import { useCallback, useEffect, useRef, useState } from "react";
import { decideReview, getReviews } from "../lib/api";
import type { HumanReview, ReviewPage } from "../lib/api";
import {
  mergeReviewPage,
  reviewPageOffset,
  selectedReview,
} from "../lib/reviewQueue";

export function useReviewQueue(revision: number, onDecision: () => void) {
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [{ offset, submitterId }, setQuery] = useState({
    offset: 0,
    submitterId: "",
  });
  const [loadedSubmitterId, setLoadedSubmitterId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [lastDecision, setLastDecision] = useState<HumanReview | null>(null);
  const request = useRef<{ id: number; controller?: AbortController }>({
    id: 0,
  });
  const decisionRun = useRef(0);
  const deciding = useRef(false);
  const imagesRenewedAt = useRef(0);
  const imagePage = useRef(-1);

  const cancelRefresh = useCallback(() => {
    request.current.id += 1;
    request.current.controller?.abort();
    request.current.controller = undefined;
  }, []);

  const refresh = useCallback(
    async (renewImages = false) => {
      if (deciding.current || document.visibilityState === "hidden") return;
      cancelRefresh();
      const id = request.current.id;
      const controller = new AbortController();
      request.current.controller = controller;
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      setRefreshing(true);
      try {
        const next = await getReviews(controller.signal, offset, submitterId);
        if (id !== request.current.id || controller.signal.aborted) return;
        const validOffset = reviewPageOffset(next.total, next.limit, offset);
        if (validOffset !== offset) {
          setQuery((current) => ({ ...current, offset: validOffset }));
          return;
        }
        // S3 links last five minutes; renew before expiry without reloading on every poll.
        const now = Date.now();
        const renew =
          renewImages ||
          imagePage.current !== offset ||
          now - imagesRenewedAt.current >= 240_000;
        if (renew) {
          imagesRenewedAt.current = now;
          imagePage.current = offset;
        }
        setPage((current) => mergeReviewPage(current, next, renew));
        setLoadedSubmitterId(submitterId);
        setSelectedId((current) => selectedReview(next, current)?.id ?? "");
        setError("");
      } catch (cause) {
        if (id === request.current.id) {
          setError(
            cause instanceof Error && cause.name !== "AbortError"
              ? cause.message
              : "Reviews could not be loaded. Please refresh.",
          );
        }
      } finally {
        window.clearTimeout(timeout);
        if (id === request.current.id) {
          request.current.controller = undefined;
          setRefreshing(false);
        }
      }
    },
    [offset, submitterId, cancelRefresh],
  );

  useEffect(() => {
    void refresh();
    return cancelRefresh;
  }, [revision, refresh, cancelRefresh]);

  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "hidden") {
        cancelRefresh();
        setRefreshing(false);
      } else if (!request.current.controller) {
        void refresh();
      }
    };
    const interval = window.setInterval(update, 20_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh, cancelRefresh]);

  useEffect(
    () => () => {
      decisionRun.current += 1;
      cancelRefresh();
    },
    [cancelRefresh],
  );

  const loading =
    !page || page.offset !== offset || loadedSubmitterId !== submitterId;
  const item = loading ? undefined : selectedReview(page, selectedId);

  async function decide(isHotDog: boolean) {
    if (!item || deciding.current || loading) return;
    const run = ++decisionRun.current;
    deciding.current = true;
    cancelRefresh();
    setRefreshing(false);
    setBusy(true);
    setDecisionError("");
    try {
      const review = await decideReview(item.id, isHotDog);
      if (run !== decisionRun.current) return;
      setLastDecision(review);
      setPage((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((value) => value.id !== item.id),
              total: Math.max(0, current.total - 1),
            }
          : null,
      );
      onDecision();
    } catch (cause) {
      if (run !== decisionRun.current) return;
      setDecisionError(
        cause instanceof Error
          ? cause.message
          : "The decision could not be saved. Please try again.",
      );
    } finally {
      if (run === decisionRun.current) {
        deciding.current = false;
        setBusy(false);
        // Reconcile even after an error: another reviewer may have completed it.
        void refresh();
      }
    }
  }

  return {
    page: loading ? null : page,
    item,
    offset,
    submitterId,
    loading: loading && !error,
    refreshing,
    busy,
    error: decisionError || error,
    lastDecision,
    refresh,
    decide,
    filterBySubmitter: (next: string) => {
      if (deciding.current || next === submitterId) return;
      cancelRefresh();
      setError("");
      setDecisionError("");
      setLastDecision(null);
      setSelectedId("");
      imagePage.current = -1;
      setQuery({ offset: 0, submitterId: next });
    },
    changePage: (next: number) => {
      if (!deciding.current) {
        cancelRefresh();
        setError("");
        setDecisionError("");
        setQuery((current) => ({ ...current, offset: next }));
      }
    },
  };
}
