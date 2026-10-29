import { Spinner } from "./WorkspaceState";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../lib/auth";
import { deleteAccountData } from "../lib/api";
import { supabase } from "../lib/supabase";
import "../auth.css";

function errorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "The request failed. Please try again.";
  if (message === "Invalid login credentials") return "Incorrect email or password.";
  if (message === "Email not confirmed") return "Register again with this email. Email confirmation is no longer required.";
  if (message === "User already registered") return "This email is already registered. Try signing in.";
  if (/rate limit|too many requests/i.test(message)) return "Too many attempts. Please wait a moment and try again.";
  return message;
}

export function AuthPanel({ triggerClassName = "auth-trigger", triggerLabel }: { triggerClassName?: string; triggerLabel?: string }) {
  const titleId = useId();
  const { user, loading } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const displayName = typeof user?.user_metadata.display_name === "string" ? user.user_metadata.display_name : "";

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  function show() {
    setConfirmation("");
    setName(displayName);
    setPassword("");
    setError("");
    setNotice("");
    setOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (user) {
        const { error } = await supabase.auth.updateUser({ data: { display_name: name.trim() } });
        if (error) throw error;
        setNotice("Name saved.");
      } else if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setPassword("");
        if (data.session) setOpen(false);
        else throw new Error("Could not start a session. Try signing in with this email and password.");
      } else {
        let { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error?.code === "email_not_confirmed" || error?.message === "Email not confirmed") {
          // Complete pending dev signups after enabling email autoconfirm.
          const signup = await supabase.auth.signUp({ email: email.trim(), password });
          error = signup.error;
          if (!error && !signup.data.session) throw new Error("Please register again with this email.");
        }
        if (error) throw error;
        setPassword(""); setOpen(false);
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError(""); setNotice("");
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      setOpen(false);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function deleteAccount() {
    if (busy || confirmation !== "DELETE") return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await deleteAccountData();
      if (!result.deleted) throw new Error("The account could not be deleted. Please try again.");
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) { window.location.replace("/"); return; }
      setConfirmation(""); setPassword(""); setOpen(false);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <>
    <button className={triggerClassName} type="button" disabled={loading} onClick={show} aria-haspopup="dialog">
      {loading ? <><Spinner /> One moment…</> : user ? displayName || "My profile" : triggerLabel ?? "Sign in ↗"}
    </button>
    {createPortal(<dialog className="auth-dialog" ref={dialog} onClose={() => { setOpen(false); setPassword(""); }} aria-labelledby={titleId}
      onClick={(event) => { if (event.target === dialog.current && !busy) setOpen(false); }}
      onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <div className="auth-card">
        <button className="auth-close" type="button" aria-label="Close" disabled={busy} onClick={() => setOpen(false)}>×</button>
        <p className="auth-eyebrow">HD / NOT · ACCOUNT</p>
        <h2 id={titleId}>{user ? "Your profile." : mode === "register" ? "Let’s get acquainted." : "Welcome back."}</h2>
        <p className="auth-description">{user ? "Your account, all in one place." : "Email and password. No confirmation emails."}</p>
        <form onSubmit={submit} aria-busy={busy}>
          {(user || mode === "register") && <label className="auth-field">Name
            <input autoComplete="nickname" maxLength={80} required value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
          </label>}
          <label className="auth-field">Email
            <input type="email" autoComplete="email" required value={user?.email ?? email} readOnly={!!user} disabled={busy}
              onChange={(event) => setEmail(event.target.value)} />
          </label>
          {!user && <label className="auth-field">Password
            <input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 6 : 1}
              required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
            {mode === "register" && <span className="auth-hint">At least 6 characters.</span>}
          </label>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <button className="button" disabled={busy} type="submit">{busy ? <><Spinner /> One moment…</> : user ? "Save name ↗" : mode === "register" ? "Create account ↗" : "Sign in ↗"}</button>
        </form>
        {user ? <button className="auth-switch" type="button" disabled={busy} onClick={() => void logout()}>Sign out</button>
          : <button className="auth-switch" type="button" disabled={busy} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setNotice(""); setPassword(""); }}>
            {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>}
        {user && <section className="delete-account" aria-labelledby="delete-account-title">
          <h3 id="delete-account-title">Delete account &amp; all data</h3>
          <p>This permanently deletes your account, uploaded images, certificates and check history. This cannot be undone. Stored files are queued for removal.</p>
          <label className="auth-field">Type DELETE to confirm<input value={confirmation} autoComplete="off" spellCheck={false} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
          <button className="button danger" type="button" disabled={busy || confirmation !== "DELETE"} onClick={() => void deleteAccount()}>{busy ? <><Spinner /> Please wait…</> : "Delete account & all data"}</button>
        </section>}
      </div>
    </dialog>, document.body)}
  </>;
}
