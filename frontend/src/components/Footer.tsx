import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import "../footer.css";

export function Footer() {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <footer className="app-footer">
        <p>Your mission is ours. Especially if it involves a hot dog.</p>
        <div className="footer-details">
          <address>Paris, Île-de-France, France</address>
          <button
            className="privacy-trigger"
            type="button"
            aria-haspopup="dialog"
            onClick={() => dialog.current?.showModal()}
          >
            Privacy &amp; GDPR
          </button>
        </div>
      </footer>
      {createPortal(
        <dialog
          className="privacy-dialog"
          ref={dialog}
          aria-labelledby={titleId}
        >
          <div className="privacy-heading">
            <h2 id={titleId}>Privacy &amp; GDPR</h2>
            <form method="dialog">
              <button className="privacy-close" type="submit" autoFocus>
                Close ×
              </button>
            </form>
          </div>
          <div className="privacy-content">
            <p className="privacy-intro">
              How this workspace uses your data, what is shared, and the
              controls available to you.
            </p>

            <section>
              <h3>What we process</h3>
              <p>
                Your account details, uploaded images, file names,
                classification results, model usage and review records support
                sign-in, classification, team access and certificates. Supabase
                provides authentication and stores application records. AWS S3
                stores images and certificate files. Images are sent to
                Anthropic’s Claude models when a new AI classification is
                needed.
              </p>
            </section>

            <section>
              <h3>Who can see it</h3>
              <p>
                Team administrators and supervisors can see team activity.
                Authorized reviewers can view images submitted for human review;
                the team directory includes member names and email addresses.
              </p>
              <p>
                Certificate verification links are public: anyone with a link
                can view its evidence and download the certificate. Public
                records exclude your account email and owner ID. Signed PDF
                download links expire after five minutes; the verification link
                itself remains usable while the certificate exists. Share links
                only with people you intend to give access to.
              </p>
            </section>

            <section>
              <h3>How long data stays</h3>
              <p>
                Original uploads are stored in a private S3 bucket with a
                one-day expiry rule. Storage cleanup is asynchronous, so this is
                not an exact 24-hour deletion deadline. Images copied for human
                review are retained until a decision or account deletion. Check
                history, usage records and certificates remain until account
                deletion.
              </p>
            </section>

            <section>
              <h3>Your controls</h3>
              <p>
                In the workspace, open your profile to update your display name
                or choose <strong>Delete account &amp; all data</strong>.
                Deletion removes your account, uploaded files, certificates and
                check history. A follow-up cleanup is queued with a six-minute
                delay to catch files from requests already in progress;
                processing may take longer. Copies already downloaded by others
                cannot be recalled.
              </p>
              <p>
                You can inspect your records in Activity and download individual
                certificates.
              </p>
              <p>
                <a href="https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en">
                  Your GDPR rights — European Commission
                </a>
              </p>
            </section>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
