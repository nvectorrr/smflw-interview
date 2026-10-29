import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  createTeam,
  removeTeamMember,
  roleLabels,
} from "../lib/api";
import type { TeamMember, TeamRole, TeamState } from "../lib/api";
import { useAuth } from "../lib/auth";

import { AuthPanel } from "./AuthPanel";
import { TeamInvitation } from "./team/TeamInvitation";
import { TeamMembers } from "./team/TeamMembers";
import { TeamSetupForms } from "./team/TeamSetupForms";
import { EmptyState, LoadingState, Spinner } from "./WorkspaceState";
export function TeamPanel({
  state,
  loading,
  loadError,
  onChange,
  onRefresh,
  onAccepted,
}: {
  state: TeamState | null;
  loading: boolean;
  loadError: string;
  onChange: (state: TeamState) => void;
  onRefresh: () => void;
  onAccepted: () => void;
}) {
  const { user } = useAuth();
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const removeDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (removeOpen) removeDialog.current?.showModal();
    else removeDialog.current?.close();
  }, [removeOpen]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState<TeamRole>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitation, setInvitation] = useState<{
    code: string;
    expires_at: string;
  } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!invitation) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [invitation]);
  const remaining = invitation
    ? Math.max(0, Math.ceil((Date.parse(invitation.expires_at) - now) / 1000))
    : 0;
  const team = state?.team;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The request failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Invitation code copied. Send it to your teammate.");
    } catch {
      setNotice("Code created. Select the code below to copy it manually.");
    }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      onChange(await createTeam(name.trim()));
      setNotice("Team created. Administrator access granted.");
    });
  }
  function join(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      onChange(await acceptInvitation(code.trim().toUpperCase()));
      setCode("");
      onAccepted();
      setNotice("Invitation accepted. Team access granted.");
    });
  }
  function invite(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const pending = createInvitation(role);
      // Start the clipboard operation during the click; Safari requires user activation.
      let automaticCopy: Promise<boolean> | undefined;
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        try {
          automaticCopy = navigator.clipboard
            .write([
              new ClipboardItem({
                "text/plain": pending.then(
                  (result) => new Blob([result.code], { type: "text/plain" }),
                ),
              }),
            ])
            .then(
              () => true,
              () => false,
            );
        } catch {
          automaticCopy = Promise.resolve(false);
        }
      }
      const result = await pending;
      setInvitation(result);
      setNow(Date.now());
      if (automaticCopy) {
        setNotice(
          (await automaticCopy)
            ? "Invitation code copied. Send it to your teammate."
            : "Code created. Use Copy code below, or select it to copy manually.",
        );
      } else {
        await copy(result.code);
      }
      onRefresh();
    });
  }
  function updateMemberRole(userId: string, next: TeamRole) {
    void run(async () => {
      onChange(await changeMemberRole(userId, next));
      setNotice("Member role updated.");
    });
  }
  async function paste() {
    try {
      setCode((await navigator.clipboard.readText()).trim().toUpperCase());
      setError("");
    } catch {
      setError(
        "Clipboard access is unavailable. Paste the code into the field manually.",
      );
    }
  }
  return (
    <section
      className="team-section"
      aria-labelledby="team-title"
      aria-busy={loading || busy}
    >
      <div className="activity-heading">
        <div>
          <p className="eyebrow">03 / ACCESS & ORGANIZATION</p>
          <h1 id="team-title">Team management</h1>
          <p className="subtitle">
            Coordinate access, responsibilities and human oversight.
          </p>
        </div>
        {user && (
          <button
            className="activity-refresh"
            disabled={loading || busy}
            onClick={onRefresh}
          >
            {loading || busy ? (
              <>
                <Spinner /> Updating…
              </>
            ) : loadError ? (
              "Try again ↻"
            ) : (
              "Refresh ↻"
            )}
          </button>
        )}
      </div>
      {loadError && (
        <EmptyState
          title="Team unavailable"
          description={loadError}
          kind="team"
        />
      )}
      {error && !removeOpen && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="team-notice" role="status">
          {notice}
        </p>
      )}
      {loading && !state ? (
        <LoadingState label="Loading team configuration…" />
      ) : !user ? (
        <EmptyState
          kind="team"
          title="Your team starts here"
          description="Sign in or create an account. Then create a workspace or enter your seven-character invitation code."
        >
          <AuthPanel
            triggerClassName="button"
            triggerLabel="Sign in / Create account ↗"
          />
        </EmptyState>
      ) : team ? (
        <>
          <div className="team-card team-summary">
            <div>
              <span className="review-label">ACTIVE WORKSPACE</span>
              <h2>{team.name}</h2>
              <p>
                Membership and privileges are managed by your team
                administrator.
              </p>
            </div>
            <span className="role-badge">{roleLabels[team.role]}</span>
          </div>
          <details className="role-help">
            <summary>Role permissions</summary>
            <div className="role-guide">
              <p>
                <strong>01 / User</strong>Classification, personal history,
                escalation.
              </p>
              <p>
                <strong>02 / Supervisor</strong>Team activity and human
                determination.
              </p>
              <p>
                <strong>03 / Admin</strong>Team oversight, invitations and
                access control.
              </p>
            </div>
          </details>
          {team.role === "admin" && (
            <div className="team-columns">
              <TeamInvitation
                role={role}
                busy={busy}
                loading={loading}
                invitation={invitation}
                remaining={remaining}
                onRoleChange={setRole}
                onInvite={invite}
                onCopy={copy}
              />
              <TeamMembers
                members={state.members}
                userId={user.id}
                busy={busy}
                loading={loading}
                onRemove={(member) => {
                  setError("");
                  setRemoving(member);
                  setRemoveOpen(true);
                }}
                onRoleChange={updateMemberRole}
              />
            </div>
          )}
        </>
      ) : (
        state && (
          <TeamSetupForms
            name={name}
            code={code}
            busy={busy}
            onNameChange={setName}
            onCodeChange={setCode}
            onCreate={create}
            onJoin={join}
            onPaste={paste}
          />
        )
      )}
      <dialog
        className="auth-dialog remove-dialog"
        ref={removeDialog}
        aria-labelledby="remove-member-title"
        aria-describedby="remove-member-description"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setRemoveOpen(false);
        }}
        onClose={() => setRemoveOpen(false)}
      >
        {removing && (
          <div className="auth-card">
            <p className="auth-eyebrow">TEAM ACCESS</p>
            <h2 id="remove-member-title">Remove member?</h2>
            <p id="remove-member-description" className="auth-description">
              <strong>
                {removing.display_name || removing.email || "This member"}
              </strong>{" "}
              will lose access to this team. Their account and existing check
              history will be kept. They can rejoin with a new invitation.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                autoFocus
                disabled={busy}
                onClick={() => setRemoveOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await removeTeamMember(removing.user_id);
                    onChange(next);
                    setRemoveOpen(false);
                    setNotice("Member removed. Team access revoked.");
                  })
                }
              >
                {busy ? (
                  <>
                    <Spinner /> Removing…
                  </>
                ) : (
                  "Remove member"
                )}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
