import { modelLabel } from "../../lib/api";
import type { HistoryPage, TeamState } from "../../lib/api";
import { CertificateDownload } from "../CertificatePanel";
import { RequestReview, ReviewOutcome } from "../HumanReview";

const number = (value: number) => value.toLocaleString("en-GB");

type ActivityRecordsProps = {
  page: HistoryPage;
  loading: boolean;
  offset: number;
  selectedId: string | null;
  teamView: boolean;
  team: TeamState["team"];
  userId: string;
  onSelect: (id: string) => void;
  onOffsetChange: (offset: number) => void;
  onReviewRequested: () => void;
};

export function ActivityRecords({
  page,
  loading,
  offset,
  selectedId,
  teamView,
  team,
  userId,
  onSelect,
  onOffsetChange,
  onReviewRequested,
}: ActivityRecordsProps) {
  const selected = page.items.find((item) => item.id === selectedId);
  return (
    <>
      <div className="history-heading">
        <h2>Check registry</h2>
        <span>{number(page.total)} matching records</span>
      </div>
      <div className="activity-workspace">
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead>
              <tr>
                <th>Image / submitted</th>
                {teamView && <th>Member</th>}
                <th>Verdict</th>
                <th>Review</th>
                <th>Model</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => {
                const finalVerdict =
                  item.review?.status === "completed"
                    ? item.review.is_hot_dog
                    : item.is_hot_dog;
                return (
                  <tr
                    key={item.id}
                    className={selectedId === item.id ? "selected" : ""}
                  >
                    <td>
                      <button
                        className="registry-select"
                        aria-pressed={selectedId === item.id}
                        onClick={() => onSelect(item.id)}
                      >
                        <strong>{item.image_name || item.file_name}</strong>
                        <small>
                          {new Date(item.created_at).toLocaleString("en-GB", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </small>
                      </button>
                    </td>
                    {teamView && (
                      <td>
                        {item.user_display_name ||
                          item.user_email ||
                          "Team member"}
                      </td>
                    )}
                    <td>
                      <span
                        className={`history-verdict ${finalVerdict ? "yes" : "no"}`}
                      >
                        {finalVerdict ? "Hot dog" : "Not hot dog"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-label ${item.review?.status ?? "unreviewed"}`}
                      >
                        {item.review?.status === "completed"
                          ? "Verified"
                          : item.review?.status === "pending"
                            ? "Pending"
                            : "—"}
                      </span>
                      {item.review?.status === "completed" && (
                        <small title={item.review.reviewer_id ?? undefined}>
                          By {item.review.reviewer_name || "Team reviewer"}
                        </small>
                      )}
                    </td>
                    <td>
                      {modelLabel(item.model)}
                      {item.cached && <small>Cached</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <aside className="record-inspector" aria-label="Selected check details">
          {selected && (
            <>
              <p className="eyebrow">SELECTED RECORD</p>
              <h2>{selected.image_name || selected.file_name}</h2>
              <p className="inspector-filename">{selected.file_name}</p>
              <dl className="inspector-properties">
                <dt>AI determination</dt>
                <dd>{selected.is_hot_dog ? "Hot dog" : "Not hot dog"}</dd>
                <dt>Model</dt>
                <dd>{modelLabel(selected.model)}</dd>
                <dt>Source</dt>
                <dd>
                  {selected.cached ? "Cached inference" : "Fresh inference"}
                </dd>
                <dt>Submitted</dt>
                <dd>{new Date(selected.created_at).toLocaleString("en-GB")}</dd>
              </dl>
              <details className="history-evidence">
                <summary>Evidence & provenance</summary>
                <dl>
                  <dt>Image SHA-256</dt>
                  <dd>
                    <code>{selected.image_sha256}</code>
                  </dd>
                  <dt>Check ID</dt>
                  <dd>
                    <code>{selected.id}</code>
                  </dd>
                </dl>
              </details>
              <div className="inspector-links">
                <CertificateDownload
                  certificateId={selected.certificate_id}
                  className="history-download"
                >
                  Download AI certificate ↓
                </CertificateDownload>
              </div>
              {selected.review ? (
                <ReviewOutcome review={selected.review} />
              ) : (
                team &&
                selected.team_id === team.id &&
                selected.user_id === userId && (
                  <RequestReview
                    key={selected.id}
                    checkId={selected.id}
                    onRequested={onReviewRequested}
                  />
                )
              )}
            </>
          )}
        </aside>
      </div>
      <div className="history-pagination">
        <button
          disabled={loading || offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - 20))}
        >
          ← Previous
        </button>
        <span>
          {offset + 1}–{Math.min(offset + page.items.length, page.total)} /{" "}
          {number(page.total)}
        </span>
        <button
          disabled={loading || offset + page.items.length >= page.total}
          onClick={() => onOffsetChange(offset + 20)}
        >
          Next →
        </button>
      </div>
    </>
  );
}
