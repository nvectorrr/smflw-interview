import type { FormEvent } from "react";
import { Spinner } from "../WorkspaceState";

type TeamSetupFormsProps = {
  name: string;
  code: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onCodeChange: (code: string) => void;
  onCreate: (event: FormEvent) => void;
  onJoin: (event: FormEvent) => void;
  onPaste: () => Promise<void>;
};

export function TeamSetupForms({
  name,
  code,
  busy,
  onNameChange,
  onCodeChange,
  onCreate,
  onJoin,
  onPaste,
}: TeamSetupFormsProps) {
  return (
    <div className="team-columns">
      <section className="team-card">
        <p className="eyebrow">NEW WORKSPACE</p>
        <h2>Create a team</h2>
        <p>
          Establish a shared workspace. You will receive administrator access.
        </p>
        <form onSubmit={onCreate}>
          <label className="team-field">
            Team name
            <input
              required
              minLength={1}
              maxLength={80}
              value={name}
              disabled={busy}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <button className="button" type="submit" disabled={busy}>
            {busy ? (
              <>
                <Spinner /> Working…
              </>
            ) : (
              "Create team ↗"
            )}
          </button>
        </form>
      </section>
      <section className="team-card">
        <p className="eyebrow">INVITATION</p>
        <h2>Join a team</h2>
        <p>Enter the seven-character code provided by your administrator.</p>
        <form onSubmit={onJoin}>
          <label className="team-field">
            Invitation code
            <div className="code-input-row">
              <input
                required
                minLength={7}
                maxLength={7}
                pattern="[A-Za-z0-9]{7}"
                value={code}
                disabled={busy}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXXXXX"
                onChange={(event) =>
                  onCodeChange(event.target.value.toUpperCase())
                }
              />
              <button
                className="activity-refresh"
                type="button"
                disabled={busy}
                onClick={() => void onPaste()}
              >
                Paste
              </button>
            </div>
          </label>
          <button
            className="button secondary"
            type="submit"
            disabled={busy || code.trim().length !== 7}
          >
            {busy ? (
              <>
                <Spinner /> Working…
              </>
            ) : (
              "Join team ↗"
            )}
          </button>
        </form>
      </section>
    </div>
  );
}
