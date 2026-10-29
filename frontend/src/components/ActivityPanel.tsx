import { useEffect, useState } from "react";
import { getHistory, getStats, modelLabel } from "../lib/api";
import type { HistoryPage, UsageStats, TeamState, ActivityFilters } from "../lib/api";
import { CertificateDownload } from "./CertificatePanel";
import { RequestReview, ReviewOutcome } from "./HumanReview";

import { EmptyState, LoadingState } from "./WorkspaceState";
import { SelectDropdown } from "./SelectDropdown";

const number = (value: number) => value.toLocaleString("en-GB");
export function ActivityPanel({ active, revision, team, members, userId, onClassify }: { active: boolean; revision: number; team: TeamState["team"]; members: TeamState["members"]; userId: string; onClassify: () => void }) {
  const teamView = team?.role === "admin" || team?.role === "supervisor";
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { setOffset(0); }, [revision]);
  useEffect(() => { setFilters({}); setOffset(0); setPage(null); setStats(null); }, [team?.id, team?.role]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let current = true;
    setLoading(true); setError("");
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    void Promise.all([getHistory(offset, controller.signal, filters), getStats(controller.signal, filters)]).then(([history, usage]) => {
      if (current) { setPage(history); setStats(usage); setSelectedId(value => history.items.some(item => item.id === value) ? value : history.items[0]?.id ?? null); }
    }).catch(cause => { if (current) { setPage(null); setStats(null); setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Activity could not be loaded. Please try again."); } }).finally(() => { window.clearTimeout(timeout); if (current) setLoading(false); });
    return () => { current = false; window.clearTimeout(timeout); controller.abort(); };
  }, [active, revision, offset, retry, filters]);
  function filter(key: keyof ActivityFilters, value: string) { setFilters(current => ({ ...current, [key]: value || undefined })); setOffset(0); }
  const selected = page?.items.find(item => item.id === selectedId);
  return <section className="activity" hidden={!active} aria-labelledby="activity-title" aria-busy={loading}>
    <div className="activity-heading"><div><p className="eyebrow">01 / OPERATIONAL RECORD</p><h1 id="activity-title">{teamView ? "Team activity" : "My activity"}</h1><p className="subtitle">Classification evidence, human determinations and model usage.</p></div><button className="activity-refresh" disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh ↻</button></div>
    <div className="activity-filters">
      {teamView && <div className="activity-filter"><span>Member</span><SelectDropdown label="Member" value={filters.user_id ?? ""} onChange={value => filter("user_id", value)} options={[{ value: "", label: "All members" }, ...members.map(member => ({ value: member.user_id, label: member.display_name || member.email || member.user_id }))]} /></div>}
      <div className="activity-filter"><span>Final result</span><SelectDropdown label="Final result" value={filters.result ?? ""} onChange={value => filter("result", value)} options={[{ value: "", label: "All results" }, { value: "true", label: "Hot dog" }, { value: "false", label: "Not hot dog" }]} /></div>
      <div className="activity-filter"><span>Human review</span><SelectDropdown label="Human review" value={filters.verification ?? ""} onChange={value => filter("verification", value)} options={[{ value: "", label: "All statuses" }, { value: "unreviewed", label: "Not requested" }, { value: "pending", label: "Pending" }, { value: "verified", label: "Verified" }]} /></div>
      <div className="activity-filter"><span>Model</span><SelectDropdown label="Model" value={filters.model ?? ""} onChange={value => filter("model", value)} options={[{ value: "", label: "All models" }, { value: "haiku", label: "Quick Bite" }, { value: "sonnet", label: "The Food Inspector" }]} /></div>
      <button className="activity-refresh" onClick={() => { setFilters({}); setOffset(0); }}>Reset filters</button>
    </div>
    <div role={error ? "alert" : undefined}>{error && <EmptyState title="Records unavailable" description={error}><button className="activity-refresh" onClick={() => setRetry(value => value + 1)}>Try again ↻</button></EmptyState>}</div>
    {loading && <LoadingState records label={page ? "Updating records…" : "Loading activity…"} compact={!!page} />}
    {stats && <><div className="stats-grid">{[["Checks in scope", stats.total_checks], ["Hot dogs", stats.hot_dogs], ["Not hot dogs", stats.not_hot_dogs], ["Cache hits", stats.cache_hits]].map(([label, value]) => <div className="stat" key={label}><span>{label}</span><strong>{number(value as number)}</strong></div>)}</div><details className="usage-details"><summary>Model usage / {number(stats.llm_calls)} calls · {number(stats.input_tokens + stats.output_tokens)} tokens</summary>{stats.models.map(item => <p key={item.model}><strong>{modelLabel(item.model)}</strong> · {number(item.checks)} checks · {number(item.cache_hits)} cached · {number(item.input_tokens)} input / {number(item.output_tokens)} output tokens</p>)}</details></>}
    {page && page.items.length > 0 ? <><div className="history-heading"><h2>Check registry</h2><span>{number(page.total)} matching records</span></div><div className="activity-workspace"><div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Image / submitted</th>{teamView && <th>Member</th>}<th>Verdict</th><th>Review</th><th>Model</th></tr></thead><tbody>{page.items.map(item => { const finalVerdict = item.review?.status === "completed" ? item.review.is_hot_dog : item.is_hot_dog; return <tr key={item.id} className={selectedId === item.id ? "selected" : ""}><td><button className="registry-select" aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}><strong>{item.image_name || item.file_name}</strong><small>{new Date(item.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</small></button></td>{teamView && <td>{item.user_display_name || item.user_email || "Team member"}</td>}<td><span className={`history-verdict ${finalVerdict ? "yes" : "no"}`}>{finalVerdict ? "Hot dog" : "Not hot dog"}</span></td><td><span className={`status-label ${item.review?.status ?? "unreviewed"}`}>{item.review?.status === "completed" ? "Verified" : item.review?.status === "pending" ? "Pending" : "—"}</span></td><td>{modelLabel(item.model)}{item.cached && <small>Cached</small>}</td></tr>; })}</tbody></table></div>
      <aside className="record-inspector" aria-label="Selected check details">{selected && <><p className="eyebrow">SELECTED RECORD</p><h2>{selected.image_name || selected.file_name}</h2><p className="inspector-filename">{selected.file_name}</p><dl className="inspector-properties"><dt>AI determination</dt><dd>{selected.is_hot_dog ? "Hot dog" : "Not hot dog"}</dd><dt>Model</dt><dd>{modelLabel(selected.model)}</dd><dt>Source</dt><dd>{selected.cached ? "Cached inference" : "Fresh inference"}</dd><dt>Submitted</dt><dd>{new Date(selected.created_at).toLocaleString("en-GB")}</dd></dl><details className="history-evidence"><summary>Evidence & provenance</summary><dl><dt>Image SHA-256</dt><dd><code>{selected.image_sha256}</code></dd><dt>Check ID</dt><dd><code>{selected.id}</code></dd></dl></details><div className="inspector-links"><CertificateDownload certificateId={selected.certificate_id} className="history-download">Download AI certificate ↓</CertificateDownload></div>{selected.review ? <ReviewOutcome review={selected.review} /> : team && selected.team_id === team.id && selected.user_id === userId && <RequestReview key={selected.id} checkId={selected.id} onRequested={() => setRetry(value => value + 1)} />}</>}</aside></div><div className="history-pagination"><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>← Previous</button><span>{offset + 1}–{Math.min(offset + page.items.length, page.total)} / {number(page.total)}</span><button disabled={loading || offset + page.items.length >= page.total} onClick={() => setOffset(offset + 20)}>Next →</button></div></> : !loading && !error && <EmptyState title={Object.values(filters).some(Boolean) ? "No matching records" : "Your first check starts here"} description={Object.values(filters).some(Boolean) ? "Try different filters to find the check you are looking for." : "Classify an image to start a record of results, certificates and human reviews."}>{Object.values(filters).some(Boolean) ? <button className="activity-refresh" onClick={() => { setFilters({}); setOffset(0); }}>Clear filters</button> : <button className="activity-refresh" onClick={onClassify}>Classify an image ↗</button>}</EmptyState>}
  </section>;
}
