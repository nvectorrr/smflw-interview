import { Spinner } from "./WorkspaceState";
import { useState } from "react";
import { escalateCheck } from "../lib/api";
import type { HumanReview } from "../lib/api";
import { CertificateDownload } from "./CertificatePanel";

export function ReviewOutcome({ review }: { review: HumanReview }) {
  return <div className={`human-review ${review.status}`}>
    <span className="review-label">HUMAN REVIEW</span>
    {review.status === "pending" ? <p role="status">Requested · waiting for a team reviewer.</p> : <>
      <strong>Final human verdict: {review.is_hot_dog ? "Hot dog" : "Not hot dog"}</strong>
      <p>{review.reviewer_name || "Team reviewer"}{review.reviewed_at && <> · {new Date(review.reviewed_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</>}</p>
      {review.certificate_id && <div className="review-links"><CertificateDownload certificateId={review.certificate_id} className="history-download">Download human certificate ↓</CertificateDownload></div>}
    </>}
  </div>;
}

export function RequestReview({ checkId, onRequested }: { checkId: string; onRequested: () => void }) {
  const [review, setReview] = useState<HumanReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function request() {
    if (busy) return;
    setBusy(true); setError("");
    try { setReview(await escalateCheck(checkId)); onRequested(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not request a review. Please try again."); }
    finally { setBusy(false); }
  }
  return review ? <ReviewOutcome review={review} /> : <div className="request-review" aria-busy={busy}><button className="request-review-action" type="button" disabled={busy} onClick={() => void request()}>{busy ? <><Spinner /> Requesting review…</> : <>Request human review<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg></>}</button><p>A second person in your team will review the photo.</p>{error && <p className="error" role="alert">{error}</p>}</div>;
}
