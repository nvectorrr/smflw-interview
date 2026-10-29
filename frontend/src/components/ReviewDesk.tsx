import { useEffect, useState } from "react";
import { decideReview, getReviews, modelLabel } from "../lib/api";
import type { HumanReview, ReviewPage } from "../lib/api";

import { EmptyState, LoadingState, Spinner } from "./WorkspaceState";
import { VerdictIcon } from "./ResultVerdict";

export function ReviewDesk({ revision, onDecision }: { revision: number; onDecision: () => void }) {
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [lastDecision, setLastDecision] = useState<HumanReview | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let current = true;
    setLoading(true); setError(""); setImageError(false); setImageLoaded(false);
    void getReviews(controller.signal).then(result => { if (current) setPage(result); }).catch(cause => { if (current) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Reviews could not be loaded. Please refresh."); }).finally(() => { window.clearTimeout(timeout); if (current) setLoading(false); });
    return () => { current = false; controller.abort(); window.clearTimeout(timeout); };
  }, [revision, retry]);
  const item = page?.items[0];
  async function decide(isHotDog: boolean) {
    if (!item || busy || loading || imageError || !imageLoaded) return;
    setBusy(true); setError("");
    try { const review = await decideReview(item.id, isHotDog); setLastDecision(review); setImageLoaded(false); setPage(current => current ? { ...current, items: current.items.filter(value => value.id !== item.id), total: Math.max(0, current.total - 1) } : null); setImageError(false); onDecision(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The decision could not be saved. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="review-desk" aria-labelledby="review-title" aria-busy={loading || busy}>
    <div className="activity-heading"><div><p className="eyebrow">02 / HUMAN OVERSIGHT</p><h1 id="review-title">Review desk</h1><p className="subtitle">Inspect the evidence and record a final human determination.</p></div><button className="activity-refresh" disabled={loading || busy} onClick={() => setRetry(value => value + 1)}>Refresh ↻</button></div>
    {error && <div role="alert"><EmptyState title="Review unavailable" description={error}><button className="activity-refresh" onClick={() => setRetry(value => value + 1)}>Try again ↻</button></EmptyState></div>}
    {lastDecision && <div className="review-saved" role="status"><span>Decision saved · {lastDecision.is_hot_dog ? "Hot dog" : "Not hot dog"}.</span></div>}
    {loading ? <LoadingState label="Loading the review queue…" /> : item ? <>
      <p className="queue-count">{page?.total} pending {page?.total === 1 ? "review" : "reviews"} · Your own photos are reviewed by another supervisor.</p>
      <article className="review-card" key={item.id}><div className="review-photo">{!imageLoaded && !imageError && <div className="photo-loading"><LoadingState compact label="Retrieving image…" /></div>}{imageError ? <EmptyState kind="image" title="Image unavailable" description="The private photo link may have expired."><button className="activity-refresh" onClick={() => setRetry(value => value + 1)}>Refresh photo ↻</button></EmptyState> : <img src={item.image_url} alt={`Photo submitted for review: ${item.image_name || item.file_name || "Untitled photo"}`} onLoad={() => setImageLoaded(true)} onError={() => { setImageError(true); setImageLoaded(false); }} />}</div><div className="review-card-body"><p className="review-label">SUBMITTED BY {item.submitter_name || "A TEAMMATE"}</p><h2>{item.image_name || item.file_name || "Untitled photo"}</h2><p className="review-context">{modelLabel(item.model)} said <strong>{item.original_is_hot_dog ? "Hot dog" : "Not hot dog"}</strong> · {new Date(item.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p><dl className="review-evidence"><dt>Image SHA-256</dt><dd><code>{item.image_sha256}</code></dd><dt>Review reference</dt><dd><code>{item.id}</code></dd></dl>{busy && <LoadingState compact label="Saving your determination…" />}<div className="review-decisions"><button className="review-no" type="button" disabled={busy || imageError || !imageLoaded} onClick={() => void decide(false)}>{busy ? <Spinner /> : <VerdictIcon isHotDog={false} />} Not hot dog</button><button className="review-yes" type="button" disabled={busy || imageError || !imageLoaded} onClick={() => void decide(true)}>{busy ? <Spinner /> : <VerdictIcon isHotDog={true} />} Hot dog</button></div><p className="review-final-note">Your determination is final. The original AI assessment remains in the audit record.</p></div></article>
    </> : !error && <EmptyState kind="review" title="All caught up" description="There are no photos waiting for your review. New requests from your teammates will appear here."><button className="activity-refresh" onClick={() => setRetry(value => value + 1)}>Check for requests ↻</button></EmptyState>}
  </section>;
}
