import { Spinner } from "./WorkspaceState";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { escalateCheck } from "../lib/api";
import type { HumanReview } from "../lib/api";
import { CertificateDownload } from "./CertificatePanel";

export function ReviewOutcome({ review }: { review: HumanReview }) {
  return (
    <div className={`human-review ${review.status}`}>
      <span className="review-label">HUMAN REVIEW</span>
      {review.status === "pending" ? (
        <p role="status">
          Requested · in the shared team queue. Another supervisor will review
          it.
        </p>
      ) : (
        <>
          <strong>
            Final human verdict: {review.is_hot_dog ? "Hot dog" : "Not hot dog"}
          </strong>
          <p>
            Verified by{" "}
            <strong>{review.reviewer_name || "Team reviewer"}</strong>
            {review.reviewed_at && (
              <>
                {" "}
                ·{" "}
                {new Date(review.reviewed_at).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </>
            )}
          </p>
          {review.reviewer_id && (
            <details className="history-evidence">
              <summary>Reviewer identity</summary>
              <dl>
                <dt>User ID</dt>
                <dd>
                  <code>{review.reviewer_id}</code>
                </dd>
              </dl>
            </details>
          )}
          {review.certificate_id && (
            <div className="review-links">
              <CertificateDownload
                certificateId={review.certificate_id}
                className="history-download"
              >
                Download human certificate ↓
              </CertificateDownload>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RequestReview({
  checkId,
  onRequested,
  teamRequired = false,
  onOpenTeam,
}: {
  checkId: string;
  onRequested: () => void;
  teamRequired?: boolean;
  onOpenTeam?: () => void;
}) {
  const [review, setReview] = useState<HumanReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const joinDialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (joinOpen) joinDialog.current?.showModal();
    else joinDialog.current?.close();
  }, [joinOpen]);
  async function request() {
    if (busy) return;
    if (teamRequired) {
      setJoinOpen(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setReview(await escalateCheck(checkId));
      onRequested();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not request a review. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return review ? (
    <ReviewOutcome review={review} />
  ) : (
    <div className="request-review" aria-busy={busy}>
      <button
        className="request-review-action"
        type="button"
        disabled={busy}
        aria-haspopup={teamRequired ? "dialog" : undefined}
        onClick={() => void request()}
      >
        {busy ? (
          <>
            <Spinner /> Requesting review…
          </>
        ) : (
          <>
            Request human review
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14m-5-5 5 5-5 5" />
            </svg>
          </>
        )}
      </button>
      <p>
        {teamRequired
          ? "Human authority requires an authorized team."
          : "Any other supervisor or administrator in your team can review the photo."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {typeof document !== "undefined" &&
        createPortal(
          <dialog
            className="team-clearance-dialog"
            ref={joinDialog}
            aria-labelledby={headingId}
            aria-describedby={descriptionId}
            onClose={() => setJoinOpen(false)}
            onCancel={() => setJoinOpen(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setJoinOpen(false);
            }}
          >
            <div className="team-clearance-content">
              <p className="eyebrow">OFFICE OF ABSOLUTE CERTAINTY</p>
              <h2 id={headingId}>Organizational clearance required.</h2>
              <p id={descriptionId}>
                Independent hot dog opinions are not recognized by this
                authority. Join or create an authorized team, then run a new
                check to submit your evidence to a duly appointed supervisor.
              </p>
              <p className="team-clearance-note">
                Your mission requires an organizational chart.
              </p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setJoinOpen(false);
                    onOpenTeam?.();
                  }}
                >
                  Join or create a team ↗
                </button>
                <button
                  type="button"
                  className="activity-refresh"
                  onClick={() => setJoinOpen(false)}
                >
                  Dismiss notice
                </button>
              </div>
            </div>
          </dialog>,
          document.body,
        )}
    </div>
  );
}
