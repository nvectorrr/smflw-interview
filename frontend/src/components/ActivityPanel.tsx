import { useEffect, useState } from "react";
import { getHistory, getStats } from "../lib/api";
import type {
  HistoryPage,
  UsageStats,
  TeamState,
  ActivityFilters,
} from "../lib/api";

import { EmptyState, Spinner } from "./WorkspaceState";
import { ActivityFiltersBar } from "./activity/ActivityFiltersBar";
import { ActivityStats } from "./activity/ActivityStats";
import {
  ActivityRecords,
  ActivityRecordsSkeleton,
} from "./activity/ActivityRecords";
import "./activity/activity-stability.css";

export function ActivityPanel({
  active,
  revision,
  team,
  members,
  userId,
  onClassify,
  onOpenTeam,
}: {
  active: boolean;
  revision: number;
  team: TeamState["team"];
  members: TeamState["members"];
  userId: string;
  onClassify: () => void;
  onOpenTeam: () => void;
}) {
  const teamView = team?.role === "admin" || team?.role === "supervisor";
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError("");
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    void Promise.all([
      getHistory(offset, controller.signal, filters),
      getStats(controller.signal, filters),
    ])
      .then(([history, usage]) => {
        if (current) {
          const lastOffset =
            Math.max(0, Math.ceil(history.total / history.limit) - 1) *
            history.limit;
          if (offset > lastOffset) {
            setOffset(lastOffset);
            return;
          }
          setPage(history);
          setStats(usage);
          setSelectedId((value) =>
            history.items.some((item) => item.id === value)
              ? value
              : (history.items[0]?.id ?? null),
          );
        }
      })
      .catch((cause) => {
        if (current) {
          setError(
            cause instanceof Error && cause.name !== "AbortError"
              ? cause.message
              : "Activity could not be loaded. Please try again.",
          );
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [active, revision, offset, retry, filters]);
  function filter(key: keyof ActivityFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
    setOffset(0);
  }
  function resetFilters() {
    setFilters({});
    setOffset(0);
  }
  return (
    <section
      className="activity"
      hidden={!active}
      aria-labelledby="activity-title"
      aria-busy={loading}
    >
      <div className="activity-heading">
        <div>
          <p className="eyebrow">01 / OPERATIONAL RECORD</p>
          <h1 id="activity-title">
            {teamView ? "Team activity" : "My activity"}
          </h1>
          <p className="subtitle">
            Classification evidence, human determinations and model usage.
          </p>
        </div>
        <button
          className="activity-refresh"
          disabled={loading}
          onClick={() => setRetry((value) => value + 1)}
        >
          {loading ? (
            <>
              <Spinner /> Updating…
            </>
          ) : error ? (
            "Try again ↻"
          ) : (
            "Refresh ↻"
          )}
        </button>
      </div>
      <ActivityFiltersBar
        teamView={teamView}
        members={members}
        filters={filters}
        onFilter={filter}
        onReset={resetFilters}
      />
      <div role={error ? "alert" : undefined}>
        {error &&
          (page ? (
            <p className="error">{error}</p>
          ) : (
            <EmptyState title="Records unavailable" description={error} />
          ))}
      </div>
      {loading && !page ? (
        <ActivitySkeleton teamView={teamView} />
      ) : (
        stats && <ActivityStats stats={stats} />
      )}
      {page && page.items.length > 0 ? (
        <ActivityRecords
          active={active}
          page={page}
          loading={loading}
          offset={page.offset}
          selectedId={selectedId}
          teamView={teamView}
          team={team}
          userId={userId}
          onOpenTeam={onOpenTeam}
          onSelect={setSelectedId}
          onOffsetChange={setOffset}
          onReviewRequested={() => setRetry((value) => value + 1)}
        />
      ) : (
        page && (
          <EmptyState
            title={
              Object.values(filters).some(Boolean)
                ? "No matching records"
                : "Your first check starts here"
            }
            description={
              Object.values(filters).some(Boolean)
                ? "Try different filters to find the check you are looking for."
                : "Classify an image to start a record of results, certificates and human reviews."
            }
          >
            {!Object.values(filters).some(Boolean) && (
              <button className="activity-refresh" onClick={onClassify}>
                Classify an image ↗
              </button>
            )}
          </EmptyState>
        )
      )}
    </section>
  );
}

function ActivitySkeleton({ teamView }: { teamView: boolean }) {
  return (
    <div className="activity-skeleton" role="status">
      <span className="sr-only">Loading activity…</span>
      <div aria-hidden="true">
        <ActivityStats stats={null} />
        <ActivityRecordsSkeleton teamView={teamView} />
      </div>
    </div>
  );
}

export function ActivityBootstrap() {
  return (
    <section
      className="activity"
      aria-busy="true"
      aria-label="Loading activity"
    >
      <div className="activity-heading">
        <div>
          <p className="eyebrow">01 / OPERATIONAL RECORD</p>
          <h1>Activity</h1>
          <p className="subtitle">
            Classification evidence, human determinations and model usage.
          </p>
        </div>
        <button className="activity-refresh" disabled>
          <Spinner /> Updating…
        </button>
      </div>
      <ActivityFiltersBar
        teamView
        members={[]}
        filters={{}}
        disabled
        onFilter={() => {}}
        onReset={() => {}}
      />
      <ActivitySkeleton teamView />
    </section>
  );
}
