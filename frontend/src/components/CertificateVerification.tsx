import { Footer } from "./Footer";
import { ThemeToggle } from "./ThemeToggle";
import { Spinner } from "./WorkspaceState";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "../certificates.css";
import "../verification-layout.css";
import { CertificateDownload } from "./CertificatePanel";
import { modelLabel } from "../lib/api";

type VerifiedCertificate = {
  verified: true;
  schema_version?: number;
  verification_method?: string;
  record_type?: string;
  human_verified?: boolean;
  original_certificate_id?: string;
  review_id?: string;
  reviewer_name?: string;
  human_statement?: string;
  certificate_id: string;
  issuer: string;
  issued_at: string;
  image_sha256: string;
  is_hot_dog: boolean;
  classifier_model: string;
  record_sha256: string;
};
type VerificationState =
  | { kind: "loading" }
  | { kind: "verified"; record: VerifiedCertificate }
  | { kind: "missing" | "invalid" | "error" };

const apiUrl = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validRecord(
  value: unknown,
  certificateId: string,
): value is VerifiedCertificate {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<VerifiedCertificate>;
  const human =
    record.schema_version === 2 ||
    record.verification_method === "human" ||
    record.record_type === "human_review";
  if (
    human &&
    (record.schema_version !== 2 ||
      !uuidPattern.test(record.original_certificate_id ?? "") ||
      !uuidPattern.test(record.review_id ?? "") ||
      !(
        record.verification_method === "human" ||
        (record.record_type === "human_review" &&
          record.human_verified === true)
      ))
  )
    return false;
  return (
    record.verified === true &&
    record.certificate_id?.toLowerCase() === certificateId.toLowerCase() &&
    typeof record.is_hot_dog === "boolean" &&
    typeof record.image_sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(record.image_sha256) &&
    typeof record.record_sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(record.record_sha256) &&
    typeof record.issued_at === "string" &&
    Number.isFinite(Date.parse(record.issued_at)) &&
    typeof record.classifier_model === "string" &&
    typeof record.issuer === "string"
  );
}

export function CertificateVerification({
  certificateId,
}: {
  certificateId: string;
}) {
  const [state, setState] = useState<VerificationState>({ kind: "loading" });
  const [fileCheck, setFileCheck] = useState<{
    name: string;
    status: "checking" | "match" | "mismatch" | "error";
  } | null>(null);
  const comparisonVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    comparisonVersion.current += 1;
    setFileCheck(null);
    if (!uuidPattern.test(certificateId)) {
      setState({ kind: "invalid" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let active = true;
    async function verify() {
      try {
        const response = await fetch(
          `${apiUrl}/certificates/${encodeURIComponent(certificateId)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );
        if (!active) return;
        if (response.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        if (response.status === 409 || response.status === 422) {
          setState({ kind: "invalid" });
          return;
        }
        if (!response.ok) throw new Error("Verification unavailable");
        const record: unknown = await response.json();
        if (active)
          setState(
            validRecord(record, certificateId)
              ? { kind: "verified", record }
              : { kind: "invalid" },
          );
      } catch {
        if (active) setState({ kind: "error" });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void verify();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [certificateId]);

  const record = state.kind === "verified" ? state.record : null;
  const human = record?.schema_version === 2;
  const loading = state.kind === "loading";
  const value = (content: ReactNode) =>
    loading ? (
      <span className="verification-placeholder" aria-hidden="true">
        <span>{content}</span>
      </span>
    ) : (
      content
    );
  async function compareFile(file?: File) {
    if (!file || !record) return;
    const version = ++comparisonVersion.current;
    if (file.size > 5 * 1024 * 1024) {
      setFileCheck({ name: file.name, status: "error" });
      return;
    }
    setFileCheck({ name: file.name, status: "checking" });
    try {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      const digest = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (version === comparisonVersion.current)
        setFileCheck({
          name: file.name,
          status: digest === record.image_sha256 ? "match" : "mismatch",
        });
    } catch {
      if (version === comparisonVersion.current)
        setFileCheck({ name: file.name, status: "error" });
    }
  }
  const title =
    state.kind === "loading"
      ? "Checking the record…"
      : state.kind === "verified"
        ? "Certificate verified."
        : state.kind === "missing"
          ? "Certificate not found."
          : state.kind === "invalid"
            ? "Verification failed."
            : "Could not verify.";

  return (
    <main className="certificate-verification">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Hot dog or not — home">
          HD<span>/</span>NOT
        </a>
        <div className="topbar-actions">
          <span className="edition">CERTIFICATE VERIFICATION</span>
          <ThemeToggle />
        </div>
      </header>
      <div className="verification-workspace">
        <section className="intro">
          <p className="eyebrow">04 / CERTIFICATE REGISTRY</p>
          <h1>Certificate verification</h1>
          <p className="subtitle">
            The recorded verdict and your photo’s digital fingerprint.
          </p>
        </section>
        <section
          className={`certificate-verification-card ${record ? "is-verified" : ""}`}
          aria-busy={loading}
        >
          <div className="verification-status" role="status" aria-live="polite">
            {loading && <span className="sr-only">{title}</span>}
            {loading ? (
              <span className="verification-spinner" aria-hidden="true">
                <Spinner />
              </span>
            ) : (
              <span
                className="certificate-verification-symbol"
                aria-hidden="true"
              >
                {record ? "✓" : "?"}
              </span>
            )}
            <div className="verification-status-copy">
              <h2>{value(loading ? "Certificate verified." : title)}</h2>
              <p>
                {value(
                  record || loading
                    ? "The record was found and its stored data integrity is confirmed."
                    : state.kind === "missing"
                      ? "There is no certificate with this identifier."
                      : state.kind === "invalid"
                        ? "The identifier or certificate data could not be verified."
                        : state.kind === "error"
                          ? "The service is temporarily unavailable. Please refresh the page shortly."
                          : "Matching this identifier against the stored certificate.",
                )}
              </p>
            </div>
          </div>
          {(loading || record) && (
            <div
              className="verification-record-layout"
              aria-hidden={loading || undefined}
            >
              <div className="verification-evidence">
                <dl className="certificate-evidence">
                  <div>
                    <dt>Certificate</dt>
                    <dd>
                      <code>
                        {value(record?.certificate_id ?? certificateId)}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>Issued (UTC)</dt>
                    <dd>
                      {value(
                        record
                          ? new Date(record.issued_at)
                              .toISOString()
                              .replace("T", " ")
                              .replace("Z", " UTC")
                          : "0000-00-00 00:00:00.000 UTC",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{human ? "Human reviewer" : "Inspector"}</dt>
                    <dd>
                      {value(
                        human
                          ? record?.reviewer_name ||
                              "Authorized team supervisor"
                          : modelLabel(record?.classifier_model ?? "sonnet"),
                      )}
                    </dd>
                  </div>
                  {human && (
                    <>
                      <div className="verification-human-reference">
                        <dt>Original AI certificate</dt>
                        <dd>
                          <code>{record?.original_certificate_id}</code>
                        </dd>
                      </div>
                      <div className="verification-human-reference">
                        <dt>Review</dt>
                        <dd>
                          <code>{record?.review_id}</code>
                        </dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>Original photo SHA-256</dt>
                    <dd>
                      <code>
                        {value(record?.image_sha256 ?? "0".repeat(64))}
                      </code>
                    </dd>
                  </div>
                </dl>
                <p className="certificate-verification-note">
                  {value(
                    <>
                      Compare your file’s SHA-256 with the value above. A match
                      confirms that the verdict belongs to this photo.{" "}
                      {human
                        ? record?.human_statement ||
                          "A human team reviewer made this final decision. The original AI verdict is preserved in its own certificate."
                        : "The original AI determination is preserved in the certificate."}
                    </>,
                  )}
                </p>
              </div>
              <aside
                className="verification-actions"
                aria-label="Verdict and document actions"
              >
                <div className="certificate-verified-verdict">
                  <span>
                    {value(
                      human ? "FINAL HUMAN VERDICT" : "ORIGINAL AI VERDICT",
                    )}
                  </span>
                  <strong>
                    {value(record?.is_hot_dog ? "Hot dog." : "Not hot dog.")}
                  </strong>
                  <code>
                    {value(
                      `is_hot_dog = ${String(record?.is_hot_dog ?? false)}`,
                    )}
                  </code>
                </div>
                <div className="certificate-file-check">
                  <label
                    id="compare-file-label"
                    htmlFor="certificate-compare-file"
                  >
                    Compare with your file
                  </label>
                  <p>
                    The SHA-256 is calculated in your browser. Your file stays
                    on your device.
                  </p>
                  <div className="compare-file-control">
                    <button
                      className="activity-refresh"
                      type="button"
                      disabled={loading || fileCheck?.status === "checking"}
                      onClick={() => fileInput.current?.click()}
                    >
                      {value("Choose image")}
                    </button>
                    <span className="compare-file-name" title={fileCheck?.name}>
                      {value(fileCheck?.name || "No file selected")}
                    </span>
                  </div>
                  <input
                    ref={fileInput}
                    hidden
                    aria-labelledby="compare-file-label"
                    id="certificate-compare-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={loading || fileCheck?.status === "checking"}
                    onChange={(event) => {
                      void compareFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  {fileCheck && (
                    <p
                      className={`certificate-file-result ${fileCheck.status}`}
                      role="status"
                    >
                      {fileCheck.status === "checking" ? (
                        <>
                          <Spinner /> Calculating fingerprint…
                        </>
                      ) : fileCheck.status === "match" ? (
                        "Match: this certificate belongs to your file."
                      ) : fileCheck.status === "mismatch" ? (
                        "The fingerprint differs. This is a different file or an edited copy."
                      ) : (
                        "Could not read the file. Choose an image up to 5 MB; fingerprint comparison requires a secure connection."
                      )}
                    </p>
                  )}
                </div>
                {loading ? (
                  <button
                    className="button certificate-download"
                    type="button"
                    disabled
                  >
                    {value("Download PDF ↓")}
                  </button>
                ) : (
                  <CertificateDownload certificateId={certificateId}>
                    Download PDF ↓
                  </CertificateDownload>
                )}
              </aside>
            </div>
          )}
          {state.kind === "error" && (
            <button
              className="activity-refresh"
              onClick={() => window.location.reload()}
            >
              Try again ↻
            </button>
          )}
          <a className="certificate-record-link" href="/">
            Check a new photo ↗
          </a>
        </section>
      </div>
      <Footer />
    </main>
  );
}
