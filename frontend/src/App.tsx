import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { checkPhoto, getCurrentTeam, modelLabels } from "./lib/api";
import type { DetectorModel, PhotoResult, TeamState } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { getTab, getTabUrl } from "./lib/navigation";
import type { AppTab } from "./lib/navigation";
import { ThemeToggle } from "./components/ThemeToggle";
import { AuthPanel } from "./components/AuthPanel";
import { CertificatePanel } from "./components/CertificatePanel";
import { ActivityPanel } from "./components/ActivityPanel";
import { CertificateVerification } from "./components/CertificateVerification";
import { TeamPanel } from "./components/TeamPanel";
import { ReviewDesk } from "./components/ReviewDesk";
import { ResultVerdict } from "./components/ResultVerdict";
import { RequestReview } from "./components/HumanReview";
import "./teams.css";
import { EmptyState, LoadingState, Spinner, StateIcon } from "./components/WorkspaceState";

const getInviteToken = () => window.location.pathname.match(/^\/join\/([^/]+)\/?$/)?.[1] || new URLSearchParams(window.location.search).get("invite") || "";

type Phase = "idle" | "uploading" | "classifying" | "done" | "error";
const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

function HotDogApp() {
  const { user, loading: authLoading } = useAuth();
  const activeRun = useRef(0);
  const [tab, setActiveTab] = useState(() => getTab(new URL(window.location.href)));
  const setTab = useCallback((next: AppTab, replace = false) => {
    const url = getTabUrl(new URL(window.location.href), next);
    if (url.href !== window.location.href) {
      window.history[replace ? "replaceState" : "pushState"](window.history.state, "", url);
    }
    setActiveTab(next);
  }, []);
  const [teamState, setTeamState] = useState<TeamState | null>(null);
  const [teamLoading, setTeamLoading] = useState(!!user);
  const [teamError, setTeamError] = useState("");
  const [teamRevision, setTeamRevision] = useState(0);
  const [inviteToken, setInviteToken] = useState(getInviteToken);
  const reviewer = teamState?.team?.role === "admin" || teamState?.team?.role === "supervisor";
  const [model, setModel] = useState<DetectorModel>("haiku");
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [activityRevision, setActivityRevision] = useState(0);
  const [certificate, setCertificate] = useState<PhotoResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = phase === "uploading" || phase === "classifying";
  const workspaceLoading = authLoading || (!!user && teamLoading && !teamState);
  const workspaceError = !authLoading && !!user && !!teamError;

  useEffect(() => {
    const restoreTab = () => {
      setActiveTab(getTab(new URL(window.location.href)));
      setInviteToken(getInviteToken());
    };
    window.addEventListener("popstate", restoreTab);
    return () => window.removeEventListener("popstate", restoreTab);
  }, []);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    activeRun.current += 1;
    setResult(null); setCertificate(null); setPhase("idle"); setError(null);
    if (!user) setFile(null);
    return () => { activeRun.current += 1; };
  }, [user?.id]);

  useEffect(() => {
    if (!user) { setTeamState(null); setTeamLoading(false); setTeamError(""); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let current = true;
    setTeamLoading(true); setTeamError("");
    void getCurrentTeam(controller.signal).then(state => { if (current) setTeamState(state); }).catch(cause => {
      if (current) setTeamError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Your team could not be loaded. Please refresh.");
    }).finally(() => { window.clearTimeout(timeout); if (current) setTeamLoading(false); });
    return () => { current = false; controller.abort(); window.clearTimeout(timeout); };
  }, [user?.id, teamRevision]);

  useEffect(() => {
    if (!authLoading && !teamLoading && !teamError && teamState && tab === "review" && !reviewer) {
      setTab("team", true);
    }
  }, [authLoading, teamLoading, teamError, teamState, reviewer, tab, setTab]);

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => setTeamRevision(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [user?.id]);

  function teamChanged(state: TeamState) { setTeamState(state); setActivityRevision(value => value + 1); }

  function clearPhoto() {
    if (busy) return;
    activeRun.current += 1;
    setFile(null); setDimensions(null); setResult(null); setCertificate(null);
    setPhase("idle"); setError(null); setDragging(false);
  }

  function selectFile(next?: File) {
    if (!next || busy) return;
    setResult(null);
    setCertificate(null);
    setDimensions(null);
    setPhase("idle");
    if (!allowedTypes.includes(next.type) || next.size === 0 || next.size > 5 * 1024 * 1024) {
      setFile(null);
      setError("Choose a JPG, PNG or WebP image up to 5 MB.");
      return;
    }
    setError(null);
    setFile(next);
  }

  function dropPhoto(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function classify() {
    if (!file || busy || !user) return;
    const run = ++activeRun.current;
    setError(null);
    setResult(null);
    setCertificate(null);
    setPhase("uploading");
    try {
      const answer = await checkPhoto(file, model, () => { if (run === activeRun.current) setPhase("classifying"); });
      if (run !== activeRun.current) return;
      setResult(answer.is_hot_dog);
      setCertificate(answer);
      setPhase("done");
      setActivityRevision(value => value + 1);
    } catch (cause) {
      if (run !== activeRun.current) return;
      setPhase("error");
      setError(cause instanceof DOMException && cause.name === "TimeoutError"
        ? "The check took too long. Please try again."
        : cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <main className={`app-shell ${tab === "detect" ? "is-classify" : ""}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Hot dog or not — home">HD<span>/</span>NOT</a>
        <div className="topbar-actions"><span className="edition">VISUAL INTELLIGENCE / HDN</span><ThemeToggle /><AuthPanel /></div>
      </header>

      {workspaceLoading ? <LoadingState label="Preparing your workspace…" /> : workspaceError ?
        <EmptyState kind="team" title="Workspace unavailable" description={teamError}>
          <button className="activity-refresh" onClick={() => setTeamRevision(value => value + 1)}>Try again ↻</button>
        </EmptyState> : <>
      <nav className="app-tabs" aria-label="Main navigation">
        <button type="button" aria-current={tab === "detect" ? "page" : undefined} onClick={() => setTab("detect")}>Classify</button>
        <button type="button" aria-current={tab === "activity" ? "page" : undefined} onClick={() => setTab("activity")}>{reviewer ? "Team activity" : "My activity"}</button>
        {reviewer && <button type="button" aria-current={tab === "review" ? "page" : undefined} onClick={() => setTab("review")}>Review desk</button>}
        <button type="button" aria-current={tab === "team" ? "page" : undefined} onClick={() => setTab("team")}>Team</button>
      </nav>
      <div className="classifier-content" hidden={tab !== "detect"}>
      <section className="intro" aria-labelledby="title">
        <p className="eyebrow">00 / IMAGE CLASSIFICATION</p>
        <h1 id="title">Hot dog or not?</h1>
        <p className="subtitle">Classify an image. Request a second opinion. Keep a verified record.</p>
      </section>

      <section className="workbench" aria-label="Photo check" aria-busy={busy}>
        <div className="upload-pane">
          <div className="source-heading"><p className="step-label"><span>01</span> SOURCE IMAGE</p>
            {file && <button className="clear-photo" type="button" onClick={clearPhoto} disabled={busy} aria-label="Clear image" title="Clear image"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
          </div>
          <div className={`picker ${preview ? "has-photo" : ""} ${dragging ? "dragging" : ""} ${busy ? "disabled" : ""}`}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={() => setDragging(false)} onDrop={dropPhoto}>
            <input id="photo" type="file" accept="image/jpeg,image/png,image/webp"
              aria-describedby="file-help" disabled={busy}
              onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ""; }} />
            <label htmlFor="photo">
              {preview ? <>
                <img src={preview} alt="Photo to check" onLoad={event => setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight} px`)} />
                {!busy && <span className="replace-photo">Choose another photo ↗</span>}
              </> : <div className="empty-picker">
                <span className="upload-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 21V5m0 0-6 6m6-6 6 6M6 20v7h20v-7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></span>
                <strong>Drop your photo here</strong>
                <span>or <u>choose a file</u></span>
              </div>}
            </label>
          </div>
          <div className="file-meta"><span id="file-help">JPG, PNG, WebP · up to 5 MB</span></div>
          {file && <dl className="source-metadata" aria-label="Image metadata">
            <div className="source-filename"><dt>File</dt><dd title={file.name}>{file.name}</dd></div>
            <div><dt>Format</dt><dd>{file.type.replace("image/", "").toUpperCase()}</dd></div>
            <div><dt>Size</dt><dd>{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(2)} MB`}</dd></div>
            <div><dt>Dimensions</dt><dd>{dimensions ?? "Reading…"}</dd></div>
          </dl>}
        </div>

        <div className={`verdict-pane ${result === true ? "positive" : result === false ? "negative" : ""}`}>
          <p className="step-label"><span>02</span> CLASSIFICATION</p>
          <fieldset className="model-selector" disabled={busy}>
            <legend>Choose your inspector</legend>
            {(["haiku", "sonnet"] as const).map(value => <label key={value} className={model === value ? "selected" : ""}>
              <input type="radio" name="model" value={value} checked={model === value} onChange={() => { setModel(value); setResult(null); setCertificate(null); setPhase("idle"); }} />
              <span><strong>{modelLabels[value]}</strong><small>{value === "haiku" ? "A faster answer" : "A more thorough look"}</small></span>
            </label>)}
          </fieldset>
          <div className="verdict" role="status" aria-live="polite">
            {result !== null ? <ResultVerdict isHotDog={result} /> : busy ? <>
              <div className="analysis-loader" aria-hidden="true"><StateIcon kind="image" /><span /></div>
              <h2>{phase === "uploading" ? "Uploading…" : "Checking…"}</h2>
              <p>{phase === "uploading" ? "Your photo is on its way." : "Processing visual evidence."}</p>
            </> : <>
              <StateIcon kind="image" />
              <h2>Ready to classify</h2>
              <p>{file ? "Your image is ready. Run a check to see the verdict." : "Upload an image and choose an inspector to begin."}</p>
            </>}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          {!user && !authLoading && <p className="account-hint">Sign in or create an account above to check a photo.</p>}
          {certificate && <CertificatePanel certificateId={certificate.certificate_id} />}
          {certificate?.check_id && teamState?.team && certificate.team_id === teamState.team.id && <RequestReview key={certificate.check_id} checkId={certificate.check_id} onRequested={() => setActivityRevision(value => value + 1)} />}
          {phase === "done" ? <button className="button secondary" onClick={clearPhoto}>Check another photo ↗</button>
            : <button className="button" disabled={!file || busy || !user || authLoading} onClick={classify}>
              {busy ? <><Spinner /> Processing…</> : phase === "error" ? "Try again ↗" : "Check photo ↗"}
            </button>}
          <p className="powered">VISION BY CLAUDE</p>
        </div>
      </section>
      </div>
      {user ? <ActivityPanel key={`${user.id}:${teamState?.team?.id ?? "personal"}:${teamState?.team?.role ?? "user"}`} active={tab === "activity"} revision={activityRevision} team={teamState?.team ?? null} members={teamState?.members ?? []} userId={user.id} onClassify={() => setTab("detect")} /> : tab === "activity" && <EmptyState kind="lock" title="Your record, in one place" description="Sign in or create an account to see your checks, certificates and model usage."><AuthPanel triggerClassName="button" triggerLabel="Sign in / Create account ↗" /></EmptyState>}
      {tab === "team" && <TeamPanel state={teamState} loading={authLoading || teamLoading} loadError={teamError} inviteToken={inviteToken} onChange={teamChanged} onRefresh={() => setTeamRevision(value => value + 1)} onAccepted={() => {
        setInviteToken("");
        const url = getTabUrl(new URL(window.location.href), "team");
        if (/^\/join\/[^/]+\/?$/.test(url.pathname)) url.pathname = "/";
        url.searchParams.delete("invite");
        window.history.replaceState(window.history.state, "", url);
      }} />}
      {tab === "review" && reviewer && <ReviewDesk revision={activityRevision} onDecision={() => setActivityRevision(value => value + 1)} />}
      {tab === "review" && !user && <EmptyState kind="lock" title="Review desk" description="Sign in or create an account to access your team's review desk. Reviews are available to supervisors and administrators."><AuthPanel triggerClassName="button" triggerLabel="Sign in / Create account ↗" /></EmptyState>}
      </>}
      <footer><span>HDN / Visual classification & human oversight</span><span>OPERATIONAL WORKSPACE / 2026</span></footer>
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
  return <AuthProvider><AccountApp /></AuthProvider>;
}
