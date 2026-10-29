import { useState } from "react";
import { modelLabel } from "../lib/api";
import type { ReviewItem, TeamMember } from "../lib/api";
import { useReviewQueue } from "../hooks/useReviewQueue";
import { EmptyState, LoadingState, Spinner } from "./WorkspaceState";
import { VerdictIcon } from "./ResultVerdict";
import { SelectDropdown } from "./SelectDropdown";

export function ReviewDesk({
  revision,
  onDecision,
  members,
}: {
  revision: number;
  onDecision: () => void;
  members: TeamMember[];
}) {
  const queue = useReviewQueue(revision, onDecision);
  return <ReviewDeskView queue={queue} members={members} />;
}

export function ReviewDeskBootstrap() {
  return (
    <ReviewDeskView
      members={[]}
      preparing
      queue={{
        page: null,
        item: undefined,
        offset: 0,
        loading: true,
        refreshing: true,
        busy: false,
        error: "",
        lastDecision: null,
        refresh: async () => {},
        decide: async () => {},
        submitterId: "",
        filterBySubmitter: () => {},
        changePage: () => {},
      }}
    />
  );
}

export function ReviewDeskView({
  queue,
  members = [],
  preparing = false,
}: {
  queue: ReturnType<typeof useReviewQueue>;
  members?: TeamMember[];
  preparing?: boolean;
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
    submitterId,
    filterBySubmitter,
    changePage,
  } = queue;
  const paginated = !!page && page.total > page.limit;
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
            A shared team queue for supervisors and administrators. Filter by
            team member; another reviewer handles your own photos.
          </p>
        </div>
        <button
          className="activity-refresh"
          disabled={refreshing || busy}
          onClick={() => void refresh(true)}
        >
          {refreshing ? (
            <>
              <Spinner /> Refreshing…
            </>
          ) : (
            "Refresh ↻"
          )}
        </button>
      </div>
      <div className="review-toolbar">
        <p className="queue-count">
          {loading
            ? "Loading the shared queue…"
            : page
              ? `${page.total} pending ${page.total === 1 ? "review" : "reviews"} available to you · Updates automatically.`
              : "Queue temporarily unavailable."}
        </p>
        <div className="activity-filters">
          <div className="activity-filter">
            <span>Team member</span>
            <SelectDropdown
              value={submitterId}
              onChange={filterBySubmitter}
              label="Team member"
              searchable
              disabled={busy || preparing}
              options={[
                { value: "", label: "All team members" },
                ...members.map((member) => ({
                  value: member.user_id,
                  label: member.display_name || member.email || "Team member",
                  description: member.display_name ? member.email : undefined,
                })),
                ...(submitterId &&
                !members.some((member) => member.user_id === submitterId)
                  ? [{ value: submitterId, label: "Former team member" }]
                  : []),
              ]}
            />
          </div>
        </div>
      </div>
      <div
        className={`review-feedback ${error ? "has-error" : ""}`}
        role={error ? "alert" : "status"}
      >
        {error ||
          (lastDecision
            ? `Decision saved · ${lastDecision.is_hot_dog ? "Hot dog" : "Not hot dog"}.`
            : "")}
      </div>
      <div className="review-stage">
        {loading ? (
          <LoadingState review label="Loading the review queue…" />
        ) : item && page ? (
          <ReviewCard
            key={`${item.id}:${item.image_url}`}
            item={item}
            busy={busy}
            onDecide={decide}
          />
        ) : (
          <EmptyState
            kind="review"
            title={
              error
                ? "Queue unavailable"
                : submitterId
                  ? "No requests from this member"
                  : "All caught up"
            }
            description={
              error ||
              (submitterId
                ? "No pending requests from this member are available to you. Choose All team members to return to the shared queue."
                : "There are no pending requests from other team members. New requests will appear here automatically.")
            }
          />
        )}
      </div>
      <nav
        className="history-pagination review-pagination"
        aria-label="Review queue pages"
        aria-hidden={!paginated}
        inert={!paginated}
        data-visible={paginated}
      >
        <button
          type="button"
          disabled={
            !paginated ||
            busy ||
            loading ||
            refreshing ||
            !page ||
            page.offset === 0
          }
          onClick={() =>
            page && changePage(Math.max(0, page.offset - page.limit))
          }
        >
          ← Previous
        </button>
        <span>
          {page
            ? `Page ${Math.floor(page.offset / page.limit) + 1} of ${Math.max(1, Math.ceil(page.total / page.limit))}`
            : "Page 1 of 1"}
        </span>
        <button
          type="button"
          disabled={
            !paginated ||
            busy ||
            loading ||
            refreshing ||
            !page ||
            page.offset + page.limit >= page.total
          }
          onClick={() => page && changePage(page.offset + page.limit)}
        >
          Next →
        </button>
      </nav>
    </section>
  );
}

function ReviewCard({
  item,
  busy,
  onDecide,
}: {
  item: ReviewItem;
  busy: boolean;
  onDecide: (isHotDog: boolean) => Promise<void>;
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
            description="The private photo link may have expired. Refresh the queue to retrieve a new link."
          />
        ) : (
          <img
            src={item.image_url}
            data-ready={imageLoaded}
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
        <div className="review-save-status" role="status">
          {busy ? "Saving your determination…" : ""}
        </div>
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
