import type { useClassifier } from "../hooks/useClassifier";
import { CertificatePanel } from "./CertificatePanel";
import { RequestReview } from "./HumanReview";
import { ResultVerdict } from "./ResultVerdict";
import { Spinner, StateIcon } from "./WorkspaceState";
import { PhotoSource } from "./PhotoSource";
import { ModelSelector } from "./ModelSelector";

type ClassifierProps = {
  active: boolean;
  loading?: boolean;
  classifier: ReturnType<typeof useClassifier>;
  teamId: string | null;
  onActivityChanged: () => void;
  onOpenTeam: () => void;
};

export function Classifier({
  active,
  loading = false,
  classifier,
  teamId,
  onActivityChanged,
  onOpenTeam,
}: ClassifierProps) {
  const {
    file,
    model,
    phase,
    result,
    certificate,
    error,
    busy,
    signedIn,
    authLoading,
    clearPhoto,
    selectModel,
    classify,
  } = classifier;
  return (
    <div
      className={`classifier-content ${loading ? "classifier-loading" : ""}`}
      hidden={!active}
      aria-busy={loading || busy}
    >
      <section className="intro" aria-labelledby="title">
        <p className="eyebrow">00 / IMAGE CLASSIFICATION</p>
        <h1 id="title">Hot dog or not?</h1>
        <p className="subtitle">
          Classify an image. Request a second opinion. Keep a verified record.
        </p>
      </section>

      {loading && (
        <span className="sr-only" role="status">
          Preparing your workspace…
        </span>
      )}
      <section
        className="workbench"
        aria-label="Photo check"
        aria-busy={loading || busy}
        inert={loading || undefined}
      >
        <PhotoSource {...classifier} />

        <div
          className={`verdict-pane ${result === true ? "positive" : result === false ? "negative" : ""}`}
        >
          <p className="step-label">
            <span>02</span> CLASSIFICATION
          </p>
          <ModelSelector model={model} busy={busy} onChange={selectModel} />
          <div className="verdict" role="status" aria-live="polite">
            {result !== null ? (
              <ResultVerdict isHotDog={result} />
            ) : busy ? (
              <>
                <div className="analysis-loader" aria-hidden="true">
                  <StateIcon kind="image" />
                  <span />
                </div>
                <h2>{phase === "uploading" ? "Uploading…" : "Checking…"}</h2>
                <p>
                  {phase === "uploading"
                    ? "Your photo is on its way."
                    : "Processing visual evidence."}
                </p>
              </>
            ) : (
              <>
                <StateIcon kind="image" />
                <h2>Ready to classify</h2>
                <p>
                  {file
                    ? "Your image is ready. Run a check to see the verdict."
                    : "Upload an image and choose an inspector to begin."}
                </p>
              </>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!signedIn && !authLoading && (
            <p className="account-hint">
              Sign in or create an account above to check a photo.
            </p>
          )}
          {certificate && (
            <CertificatePanel certificateId={certificate.certificate_id} />
          )}
          {certificate?.check_id &&
            (!teamId || certificate.team_id === teamId) && (
              <RequestReview
                key={certificate.check_id}
                checkId={certificate.check_id}
                onRequested={onActivityChanged}
                teamRequired={!teamId}
                onOpenTeam={onOpenTeam}
              />
            )}
          {phase === "done" ? (
            <button className="button secondary" onClick={clearPhoto}>
              Check another photo ↗
            </button>
          ) : (
            <button
              className="button"
              disabled={!file || busy || !signedIn || authLoading}
              onClick={classify}
            >
              {busy ? (
                <>
                  <Spinner /> Processing…
                </>
              ) : phase === "error" ? (
                "Try again ↗"
              ) : (
                "Check photo ↗"
              )}
            </button>
          )}
          <p className="powered">VISION BY CLAUDE</p>
        </div>
      </section>
    </div>
  );
}
