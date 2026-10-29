import { useEffect, useId, useRef, useState } from "react";
import { modelLabel } from "../../lib/api";
import type { HistoryPage, TeamState } from "../../lib/api";
import { CertificateDownload } from "../CertificatePanel";
import { RequestReview, ReviewOutcome } from "../HumanReview";
import "./activity-mobile.css";

const mobileQuery = "(max-width: 1050px)";

const number = (value: number) => value.toLocaleString("en-GB");

type ActivityRecordsProps = {
  active: boolean;
  page: HistoryPage;
  loading: boolean;
  offset: number;
  selectedId: string | null;
  teamView: boolean;
  team: TeamState["team"];
  userId: string;
  onOpenTeam: () => void;
  onSelect: (id: string) => void;
  onOffsetChange: (offset: number) => void;
  onReviewRequested: () => void;
};

export function ActivityRecords({
  active,
  page,
  loading,
  offset,
  selectedId,
  teamView,
  team,
  userId,
  onOpenTeam,
  onSelect,
  onOffsetChange,
  onReviewRequested,
}: ActivityRecordsProps) {
  const selected = page.items.find((item) => item.id === selectedId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const dialogTitleId = useId();
  const [mobile, setMobile] = useState(
    () => window.matchMedia(mobileQuery).matches,
  );
  const [openedId, setOpenedId] = useState<string | null>(null);

  useEffect(() => {
    const query = window.matchMedia(mobileQuery);
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (active && mobile && openedId && selected?.id === openedId) {
      if (!dialog.open) {
        dialog.scrollTop = 0;
        dialog.showModal();
      }
    } else {
      if (dialog.open) dialog.close();
      setOpenedId(null);
    }
  }, [active, mobile, openedId, selected?.id]);

  function selectRecord(id: string) {
    onSelect(id);
    if (mobile) setOpenedId(id);
  }

  const details = selected && (
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
        <dd>{selected.cached ? "Cached inference" : "Fresh inference"}</dd>
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
        selected.user_id === userId &&
        (!team || selected.team_id === team.id) && (
          <RequestReview
            key={selected.id}
            checkId={selected.id}
            teamRequired={!team}
            onOpenTeam={onOpenTeam}
            onRequested={onReviewRequested}
          />
        )
      )}
    </>
  );
  return (
    <>
      <div className="history-heading">
        <h2>Check registry</h2>
        <span>{number(page.total)} matching records</span>
      </div>
      <div className="activity-workspace">
        <div className="registry-table-wrap">
          <table className="registry-table">
            <RegistryColumns teamView={teamView} />
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
                    onClick={(event) => {
                      if (mobile) {
                        event.currentTarget
                          .querySelector<HTMLButtonElement>(".registry-select")
                          ?.focus();
                        selectRecord(item.id);
                      }
                    }}
                  >
                    <td>
                      <button
                        className="registry-select"
                        aria-pressed={selectedId === item.id}
                        aria-haspopup={mobile ? "dialog" : undefined}
                        aria-controls={mobile ? dialogId : undefined}
                        onClick={(event) => {
                          event.stopPropagation();
                          event.currentTarget.focus();
                          selectRecord(item.id);
                        }}
                      >
                        <strong title={item.image_name || item.file_name}>
                          {item.image_name || item.file_name}
                        </strong>
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
        {!mobile && (
          <aside
            className="record-inspector"
            aria-label="Selected check details"
          >
            {details}
          </aside>
        )}
      </div>
      <dialog
        ref={dialogRef}
        id={dialogId}
        className="record-dialog"
        aria-labelledby={dialogTitleId}
        onClose={() => setOpenedId(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="record-dialog-header">
          <h2 id={dialogTitleId}>Record details</h2>
          <button
            type="button"
            className="record-dialog-close"
            autoFocus
            onClick={() => dialogRef.current?.close()}
          >
            Close <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="record-inspector record-dialog-content">
          {mobile && details}
        </div>
      </dialog>
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

function RegistryColumns({ teamView }: { teamView: boolean }) {
  return (
    <>
      <colgroup>
        <col className="registry-image-column" />
        {teamView && <col className="registry-member-column" />}
        <col className="registry-verdict-column" />
        <col className="registry-review-column" />
        <col className="registry-model-column" />
      </colgroup>
      <thead>
        <tr>
          <th>Image / submitted</th>
          {teamView && <th>Member</th>}
          <th>Verdict</th>
          <th>Review</th>
          <th>Model</th>
        </tr>
      </thead>
    </>
  );
}

export function ActivityRecordsSkeleton({ teamView }: { teamView: boolean }) {
  return (
    <>
      <div className="history-heading">
        <h2>Check registry</h2>
        <span className="activity-placeholder">Loading records</span>
      </div>
      <div className="activity-workspace">
        <div className="registry-table-wrap">
          <table className="registry-table">
            <RegistryColumns teamView={teamView} />
            <tbody>
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <tr key={row}>
                  <td>
                    <span className="activity-placeholder">Image name</span>
                    <small className="activity-placeholder">Submitted at</small>
                  </td>
                  {teamView && (
                    <td>
                      <span className="activity-placeholder">Member</span>
                    </td>
                  )}
                  <td>
                    <span className="activity-placeholder">Verdict</span>
                  </td>
                  <td>
                    <span className="activity-placeholder">Review</span>
                  </td>
                  <td>
                    <span className="activity-placeholder">Model</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="record-inspector activity-inspector-skeleton">
          <p className="eyebrow">SELECTED RECORD</p>
          <h2 className="activity-placeholder">Image name</h2>
          <p className="inspector-filename activity-placeholder">Filename</p>
          <dl className="inspector-properties">
            {["AI determination", "Model", "Source", "Submitted"].map(
              (label) => (
                <div className="activity-placeholder" key={label}>
                  {label}
                </div>
              ),
            )}
          </dl>
          <p className="history-evidence activity-placeholder">
            Evidence & provenance
          </p>
          <p className="inspector-links activity-placeholder">
            Download AI certificate
          </p>
        </aside>
      </div>
      <div className="history-pagination">
        <button disabled>← Previous</button>
        <span className="activity-placeholder">Loading records</span>
        <button disabled>Next →</button>
      </div>
    </>
  );
}
