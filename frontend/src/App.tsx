import { AuthProvider, useAuth } from "./lib/auth";
import { useWorkspace } from "./hooks/useWorkspace";
import { useClassifier } from "./hooks/useClassifier";
import { ThemeToggle } from "./components/ThemeToggle";
import { AuthPanel } from "./components/AuthPanel";
import { ActivityPanel } from "./components/ActivityPanel";
import { CertificateVerification } from "./components/CertificateVerification";
import { TeamPanel } from "./components/TeamPanel";
import { ReviewDesk } from "./components/ReviewDesk";
import { Classifier } from "./components/Classifier";
import { EmptyState, LoadingState } from "./components/WorkspaceState";
import { Footer } from "./components/Footer";
import "./teams.css";

function HotDogApp() {
  const { user, loading: authLoading } = useAuth();
  const {
    tab,
    setTab,
    teamState,
    teamLoading,
    teamError,
    reviewer,
    workspaceLoading,
    workspaceError,
    activityRevision,
    refreshActivity,
    refreshTeam,
    teamChanged,
    inviteAccepted,
  } = useWorkspace();
  const classifier = useClassifier(refreshActivity);

  return (
    <main className={`app-shell ${tab === "detect" ? "is-classify" : ""}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Hot dog or not — home">
          HD<span>/</span>NOT
        </a>
        <div className="topbar-actions">
          <span className="edition">VISUAL INTELLIGENCE / HDN</span>
          <ThemeToggle />
          <AuthPanel />
        </div>
      </header>

      {workspaceLoading ? (
        <>
          <div className="app-tabs navigation-skeleton" aria-hidden="true">
            {[64, 90, 82, 42].map((width) => (
              <span key={width} style={{ width }} />
            ))}
          </div>
          {tab === "detect" ? (
            <Classifier
              active
              classifier={classifier}
              teamId={null}
              onActivityChanged={refreshActivity}
              loading
            />
          ) : (
            <div className="workspace-bootstrap">
              <div className="bootstrap-heading" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <LoadingState
                records={tab === "activity"}
                label="Preparing your workspace…"
              />
            </div>
          )}
        </>
      ) : workspaceError ? (
        <EmptyState
          kind="team"
          title="Workspace unavailable"
          description={teamError}
        >
          <button className="activity-refresh" onClick={refreshTeam}>
            Try again ↻
          </button>
        </EmptyState>
      ) : (
        <>
          <nav className="app-tabs" aria-label="Main navigation">
            <button
              type="button"
              aria-current={tab === "detect" ? "page" : undefined}
              onClick={() => setTab("detect")}
            >
              Classify
            </button>
            <button
              type="button"
              aria-current={tab === "activity" ? "page" : undefined}
              onClick={() => setTab("activity")}
            >
              {reviewer ? "Team activity" : "My activity"}
            </button>
            {reviewer && (
              <button
                type="button"
                aria-current={tab === "review" ? "page" : undefined}
                onClick={() => setTab("review")}
              >
                Review desk
              </button>
            )}
            <button
              type="button"
              aria-current={tab === "team" ? "page" : undefined}
              onClick={() => setTab("team")}
            >
              Team
            </button>
          </nav>
          <Classifier
            active={tab === "detect"}
            classifier={classifier}
            teamId={teamState?.team?.id ?? null}
            onActivityChanged={refreshActivity}
          />
          {user ? (
            <ActivityPanel
              key={`${user.id}:${teamState?.team?.id ?? "personal"}:${teamState?.team?.role ?? "user"}`}
              active={tab === "activity"}
              revision={activityRevision}
              team={teamState?.team ?? null}
              members={teamState?.members ?? []}
              userId={user.id}
              onClassify={() => setTab("detect")}
            />
          ) : (
            tab === "activity" && (
              <EmptyState
                kind="lock"
                title="Your record, in one place"
                description="Sign in or create an account to see your checks, certificates and model usage."
              >
                <AuthPanel
                  triggerClassName="button"
                  triggerLabel="Sign in / Create account ↗"
                />
              </EmptyState>
            )
          )}
          {tab === "team" && (
            <TeamPanel
              state={teamState}
              loading={authLoading || teamLoading}
              loadError={teamError}
              onChange={teamChanged}
              onRefresh={refreshTeam}
              onAccepted={inviteAccepted}
            />
          )}
          {tab === "review" && reviewer && (
            <ReviewDesk
              key={`${teamState?.team?.id}:${teamState?.team?.role}`}
              revision={activityRevision}
              onDecision={refreshActivity}
            />
          )}
          {tab === "review" && !user && (
            <EmptyState
              kind="lock"
              title="Review desk"
              description="Sign in or create an account to access your team's review desk. Reviews are available to supervisors and administrators."
            >
              <AuthPanel
                triggerClassName="button"
                triggerLabel="Sign in / Create account ↗"
              />
            </EmptyState>
          )}
        </>
      )}
      <Footer />
    </main>
  );
}

function AccountApp() {
  const { user } = useAuth();
  return <HotDogApp key={user?.id ?? "guest"} />;
}

export function App() {
  const match = window.location.pathname.match(/^\/verify\/([^/]+)\/?$/);
  if (match) return <CertificateVerification certificateId={match[1]} />;
  return (
    <AuthProvider>
      <AccountApp />
    </AuthProvider>
  );
}
