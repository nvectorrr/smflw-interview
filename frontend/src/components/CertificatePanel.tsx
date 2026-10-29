import { Spinner } from "./WorkspaceState";
import { useState } from "react";
import type { ReactNode } from "react";
import { getCertificateDownload } from "../lib/api";
import "../certificates.css";

export function CertificateDownload({
  certificateId,
  children = "Download certificate ↓",
  className = "button certificate-download",
}: {
  certificateId: string;
  children?: ReactNode;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const url = await getCertificateDownload(certificateId);
      const link = document.createElement("a");
      link.href = url;
      link.download = `HDN-${certificateId}.pdf`;
      // The signed S3 response uses Content-Disposition: attachment.
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The certificate could not be downloaded. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className={className}
        type="button"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? (
          <>
            <Spinner /> Preparing download…
          </>
        ) : (
          children
        )}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function CertificatePanel({ certificateId }: { certificateId: string }) {
  return (
    <section className="certificate-panel" aria-label="Result certificate">
      <div className="certificate-panel-heading">
        <svg
          className="certificate-document-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 3H5v18h14V8l-5-5Z" />
          <path d="M14 3v5h5M8 12h8M8 16h6" />
        </svg>
        <div>
          <strong>Result certificate</strong>
          <p>PDF · SHA-256 · verification QR</p>
        </div>
      </div>
      <div className="certificate-panel-actions">
        <CertificateDownload certificateId={certificateId}>
          Download PDF ↓
        </CertificateDownload>
      </div>
    </section>
  );
}
