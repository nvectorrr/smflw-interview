import { useState } from "react";
import { modelLabel } from "../lib/api";
import type { ReviewItem } from "../lib/api";
import { useReviewQueue } from "../hooks/useReviewQueue";
import { EmptyState, LoadingState, Spinner } from "./WorkspaceState";
import { VerdictIcon } from "./ResultVerdict";
import { SelectDropdown } from "./SelectDropdown";

export function ReviewDesk({
  revision,
  onDecision,
}: {
  revision: number;
  onDecision: () => void;
}) {
  const {
    page,
    item,
    loading,
    refreshing,
    busy,
    error,
    lastDecision,
    refresh,
    decide,
    select,
    changePage,
  } = useReviewQueue(revision, onDecision);

  return (
    <section
      className="review-desk"
      aria-labelledby="review-title"
      aria-busy={loading || busy}
    >
      <div className="activity-heading">
        <div>
          <p className="eyebrow">02 / HUMAN OVERSIGHT</p>
          <h1 id="review-title">Review desk</h1>
          <p className="subtitle">
            A shared team queue for supervisors and administrators. Choose any
            pending request; another reviewer handles your own photos.
          </p>
        </div>
        <button
          className="activity-refresh"
          disabled={refreshing || busy}
          onClick={() => void refresh(true)}
        >
          Refresh ↻
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {lastDecision && (
        <div className="review-saved" role="status">
          <span>
            Decision saved ·{" "}
            {lastDecision.is_hot_dog ? "Hot dog" : "Not hot dog"}.
          </span>
        </div>
      )}
      {loading ? (
        <LoadingState label="Loading the review queue…" />
      ) : item && page ? (
        <>
          <p className="queue-count">
            {page.total} pending {page.total === 1 ? "review" : "reviews"}{" "}
            available to you · Updates automatically.
          </p>
          <div className="activity-filters">
            <div className="activity-filter">
              <span>Choose a request</span>
              <SelectDropdown
                value={item.id}
                onChange={select}
                label="Review request"
                disabled={busy}
                options={page.items.map((request) => ({
                  value: request.id,
                  label:
                    request.image_name || request.file_name || "Untitled photo",
                  description: request.submitter_name || "A teammate",
                }))}
              />
            </div>
          </div>
          <ReviewCard
            key={`${item.id}:${item.image_url}`}
            item={item}
            busy={busy}
            onDecide={decide}
            onRefresh={() => void refresh(true)}
          />
        </>
      ) : (
        !error && (
          <EmptyState
            kind="review"
            title="All caught up"
            description="There are no pending requests from other team members. New requests will appear here automatically."
          >
            <button className="activity-refresh" onClick={() => void refresh()}>
              Check for requests ↻
            </button>
          </EmptyState>
        )
      )}
      {page && page.total > page.limit && (
        <nav className="history-pagination" aria-label="Review queue pages">
          <button
            type="button"
            disabled={busy || loading || refreshing || page.offset === 0}
            onClick={() => changePage(Math.max(0, page.offset - page.limit))}
          >
            ← Previous
          </button>
          <span>
            Page {Math.floor(page.offset / page.limit) + 1} of{" "}
            {Math.ceil(page.total / page.limit)}
          </span>
          <button
            type="button"
            disabled={
              busy ||
              loading ||
              refreshing ||
              page.offset + page.limit >= page.total
            }
            onClick={() => changePage(page.offset + page.limit)}
          >
            Next →
          </button>
        </nav>
      )}
    </section>
  );
}

function ReviewCard({
  item,
  busy,
  onDecide,
  onRefresh,
}: {
  item: ReviewItem;
  busy: boolean;
  onDecide: (isHotDog: boolean) => Promise<void>;
  onRefresh: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  return (
    <article className="review-card">
      <div className="review-photo">
        {!imageLoaded && !imageError && (
          <div className="photo-loading">
            <LoadingState compact label="Retrieving image…" />
          </div>
        )}
        {imageError ? (
          <EmptyState
            kind="image"
            title="Image unavailable"
            description="The private photo link may have expired."
          >
            <button className="activity-refresh" onClick={onRefresh}>
              Refresh photo ↻
            </button>
          </EmptyState>
        ) : (
          <img
            src={item.image_url}
            alt={`Photo submitted for review: ${item.image_name || item.file_name || "Untitled photo"}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => {
              setImageError(true);
              setImageLoaded(false);
            }}
          />
        )}
      </div>
      <div className="review-card-body">
        <p className="review-label">
          SUBMITTED BY {item.submitter_name || "A TEAMMATE"}
        </p>
        <h2>{item.image_name || item.file_name || "Untitled photo"}</h2>
        <p className="review-context">
          {modelLabel(item.model)} said{" "}
          <strong>
            {item.original_is_hot_dog ? "Hot dog" : "Not hot dog"}
          </strong>{" "}
          ·{" "}
          {new Date(item.created_at).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <dl className="review-evidence">
          <dt>Image SHA-256</dt>
          <dd>
            <code>{item.image_sha256}</code>
          </dd>
          <dt>Review reference</dt>
          <dd>
            <code>{item.id}</code>
          </dd>
        </dl>
        {busy && <LoadingState compact label="Saving your determination…" />}
        <div className="review-decisions">
          <button
            className="review-no"
            type="button"
            disabled={busy || imageError || !imageLoaded}
            onClick={() => {
              if (imageLoaded && !imageError) void onDecide(false);
            }}
          >
            {busy ? <Spinner /> : <VerdictIcon isHotDog={false} />} Not hot dog
          </button>
          <button
            className="review-yes"
            type="button"
            disabled={busy || imageError || !imageLoaded}
            onClick={() => {
              if (imageLoaded && !imageError) void onDecide(true);
            }}
          >
            {busy ? <Spinner /> : <VerdictIcon isHotDog={true} />} Hot dog
          </button>
        </div>
        <p className="review-final-note">
          Your determination is final. The original AI assessment remains in the
          audit record.
        </p>
      </div>
    </article>
  );
}
