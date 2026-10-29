import { useEffect, useState } from "react";
import { getHistory, getStats } from "../lib/api";
import type {
  HistoryPage,
  UsageStats,
  TeamState,
  ActivityFilters,
} from "../lib/api";

import { EmptyState, LoadingState } from "./WorkspaceState";
import { ActivityFiltersBar } from "./activity/ActivityFiltersBar";
import { ActivityStats } from "./activity/ActivityStats";
import { ActivityRecords } from "./activity/ActivityRecords";

export function ActivityPanel({
  active,
  revision,
  team,
  members,
  userId,
  onClassify,
}: {
  active: boolean;
  revision: number;
  team: TeamState["team"];
  members: TeamState["members"];
  userId: string;
  onClassify: () => void;
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
    setOffset(0);
  }, [revision]);
  useEffect(() => {
    setFilters({});
    setOffset(0);
    setPage(null);
    setStats(null);
  }, [team?.id, team?.role]);
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
          setPage(null);
          setStats(null);
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
          Refresh ↻
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
        {error && (
          <EmptyState title="Records unavailable" description={error}>
            <button
              className="activity-refresh"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again ↻
            </button>
          </EmptyState>
        )}
      </div>
      {loading && (
        <LoadingState
          records
          label={page ? "Updating records…" : "Loading activity…"}
          compact={!!page}
        />
      )}
      {stats && <ActivityStats stats={stats} />}
      {page && page.items.length > 0 ? (
        <ActivityRecords
          page={page}
          loading={loading}
          offset={offset}
          selectedId={selectedId}
          teamView={teamView}
          team={team}
          userId={userId}
          onSelect={setSelectedId}
          onOffsetChange={setOffset}
          onReviewRequested={() => setRetry((value) => value + 1)}
        />
      ) : (
        !loading &&
        !error && (
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
            {Object.values(filters).some(Boolean) ? (
              <button className="activity-refresh" onClick={resetFilters}>
                Clear filters
              </button>
            ) : (
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
