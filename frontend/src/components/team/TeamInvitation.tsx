import type { FormEvent } from "react";
import type { TeamRole } from "../../lib/api";
import { RoleDropdown } from "../RoleDropdown";
import { Spinner } from "../WorkspaceState";

type TeamInvitationProps = {
  role: TeamRole;
  busy: boolean;
  loading: boolean;
  invitation: { code: string; expires_at: string } | null;
  remaining: number;
  onRoleChange: (role: TeamRole) => void;
  onInvite: (event: FormEvent) => void;
  onCopy: (value: string) => Promise<void>;
};

export function TeamInvitation({
  role,
  busy,
  loading,
  invitation,
  remaining,
  onRoleChange,
  onInvite,
  onCopy,
}: TeamInvitationProps) {
  return (
    <section className="team-card">
      <p className="eyebrow">ISSUE ACCESS</p>
      <h2>Invite a member</h2>
      <p>
        Generate a single-use code. Your teammate signs in, opens Team, and
        enters it within ten minutes.
      </p>
      <form onSubmit={onInvite}>
        <div className="team-field">
          <span>Assigned role</span>
          <RoleDropdown
            label="Assigned role"
            value={role}
            disabled={busy || loading}
            onChange={onRoleChange}
          />
        </div>
        <button className="button" disabled={busy} type="submit">
          {busy ? (
            <>
              <Spinner /> Working…
            </>
          ) : (
            "Generate & copy code ↗"
          )}
        </button>
      </form>
      {invitation && (
        <div className="invite-result">
          <span className="review-label">
            {remaining
              ? `EXPIRES IN ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
              : "CODE EXPIRED"}
          </span>
          <input
            aria-label="Generated invitation code"
            className="invitation-code"
            readOnly
            value={invitation.code}
            onFocus={(event) => event.target.select()}
          />
          <button
            className="activity-refresh"
            disabled={!remaining}
            onClick={() => void onCopy(invitation.code)}
          >
            Copy code
          </button>
        </div>
      )}
    </section>
  );
}
