import type { useClassifier } from "../hooks/useClassifier";

type PhotoSourceProps = Pick<
  ReturnType<typeof useClassifier>,
  | "file"
  | "preview"
  | "dimensions"
  | "dragging"
  | "busy"
  | "clearPhoto"
  | "selectFile"
  | "setDimensions"
  | "setDragging"
>;

export function PhotoSource({
  file,
  preview,
  dimensions,
  dragging,
  busy,
  clearPhoto,
  selectFile,
  setDimensions,
  setDragging,
}: PhotoSourceProps) {
  return (
    <div className="upload-pane">
      <div className="source-heading">
        <p className="step-label">
          <span>01</span> SOURCE IMAGE
        </p>
        {file && (
          <button
            className="clear-photo"
            type="button"
            onClick={clearPhoto}
            disabled={busy}
            aria-label="Clear image"
            title="Clear image"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
      <div
        className={`picker ${preview ? "has-photo" : ""} ${dragging ? "dragging" : ""} ${busy ? "disabled" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          selectFile(event.dataTransfer.files[0]);
        }}
      >
        <input
          id="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="file-help"
          disabled={busy}
          onChange={(event) => {
            selectFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <label htmlFor="photo">
          {preview ? (
            <>
              <img
                src={preview}
                alt="Photo to check"
                onLoad={(event) =>
                  setDimensions(
                    `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight} px`,
                  )
                }
              />
              {!busy && (
                <span className="replace-photo">Choose another photo ↗</span>
              )}
            </>
          ) : (
            <div className="empty-picker">
              <span className="upload-icon" aria-hidden="true">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path
                    d="M16 21V5m0 0-6 6m6-6 6 6M6 20v7h20v-7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <strong>Drop your photo here</strong>
              <span>
                or <u>choose a file</u>
              </span>
            </div>
          )}
        </label>
      </div>
      <div className="file-meta">
        <span id="file-help">JPG, PNG, WebP · up to 5 MB</span>
      </div>
      <div className="source-meta-slot">
        {file && (
          <dl className="source-metadata" aria-label="Image metadata">
            <div className="source-filename">
              <dt>File</dt>
              <dd title={file.name}>{file.name}</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>{file.type.replace("image/", "").toUpperCase()}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {file.size < 1024 * 1024
                  ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                  : `${(file.size / (1024 * 1024)).toFixed(2)} MB`}
              </dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{dimensions ?? "Reading…"}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
