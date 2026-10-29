import type { ReactNode } from "react";

export function Spinner() {
  return <span className="inline-spinner" aria-hidden="true" />;
}

export function LoadingState({
  label,
  compact = false,
  records = false,
}: {
  label: string;
  compact?: boolean;
  records?: boolean;
}) {
  return (
    <div className={`loading-state ${compact ? "compact" : ""}`} role="status">
      <div className="loading-caption">
        <Spinner />
        <span>{label}</span>
      </div>
      {!compact &&
        (records ? (
          <div className="skeleton-layout" aria-hidden="true">
            <div className="skeleton-summary">
              {[0, 1, 2, 3].map((i) => (
                <div key={i}>
                  <i />
                  <b />
                </div>
              ))}
            </div>
            <div className="skeleton-records">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <i />
                  <i />
                  <i />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="skeleton-panel" aria-hidden="true">
            <div />
            <aside>
              <i />
              <i />
              <i />
              <b />
            </aside>
          </div>
        ))}
    </div>
  );
}

export function StateIcon({
  kind = "records",
}: {
  kind?: "records" | "review" | "team" | "image" | "lock";
}) {
  return (
    <span className={`state-icon state-icon-${kind}`} aria-hidden="true">
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "review" ? (
          <>
            <circle cx="20" cy="20" r="13" />
            <path d="m13 20 5 5 10-11" />
          </>
        ) : kind === "team" ? (
          <>
            <circle cx="15" cy="14" r="5" />
            <path d="M5 32v-3a10 10 0 0 1 20 0v3M28 10a5 5 0 0 1 0 10m2 4a8 8 0 0 1 5 8" />
          </>
        ) : kind === "lock" ? (
          <>
            <rect x="10" y="18" width="20" height="16" rx="2" />
            <path d="M14 18v-6a6 6 0 0 1 12 0v6M20 25v3" />
          </>
        ) : kind === "image" ? (
          <>
            <path d="M13 5H5v8m22-8h8v8M5 27v8h8m22-8v8h-8" />
            <circle cx="16" cy="16" r="3" />
            <path d="m9 29 9-8 5 4 5-7 4 11" />
          </>
        ) : (
          <>
            <rect x="9" y="5" width="22" height="30" rx="2" />
            <path d="M15 14h10m-10 6h10m-10 6h6" />
          </>
        )}
      </svg>
    </span>
  );
}

export function EmptyState({
  title,
  description,
  kind,
  children,
}: {
  title: string;
  description: string;
  kind?: "records" | "review" | "team" | "image" | "lock";
  children?: ReactNode;
}) {
  return (
    <div className="workspace-empty">
      <StateIcon kind={kind} />
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="state-actions">{children}</div>}
    </div>
  );
}
