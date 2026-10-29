import { useCallback, useEffect, useState } from "react";
import { getCurrentTeam } from "../lib/api";
import type { TeamState } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getTab, getTabUrl } from "../lib/navigation";
import type { AppTab } from "../lib/navigation";

export function useWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setActiveTab] = useState(() =>
    getTab(new URL(window.location.href)),
  );
  const setTab = useCallback((next: AppTab, replace = false) => {
    const url = getTabUrl(new URL(window.location.href), next);
    if (url.href !== window.location.href) {
      window.history[replace ? "replaceState" : "pushState"](
        window.history.state,
        "",
        url,
      );
    }
    setActiveTab(next);
  }, []);
  const [teamState, setTeamState] = useState<TeamState | null>(null);
  const [teamLoading, setTeamLoading] = useState(!!user);
  const [teamError, setTeamError] = useState("");
  const [teamRevision, setTeamRevision] = useState(0);
  const reviewer =
    teamState?.team?.role === "admin" || teamState?.team?.role === "supervisor";
  const [activityRevision, setActivityRevision] = useState(0);
  const refreshActivity = useCallback(
    () => setActivityRevision((value) => value + 1),
    [],
  );
  const refreshTeam = useCallback(
    () => setTeamRevision((value) => value + 1),
    [],
  );
  const workspaceLoading = authLoading || (!!user && teamLoading && !teamState);
  const workspaceError = !authLoading && !!user && !!teamError;

  useEffect(() => {
    const restoreTab = () => {
      setActiveTab(getTab(new URL(window.location.href)));
    };
    window.addEventListener("popstate", restoreTab);
    return () => window.removeEventListener("popstate", restoreTab);
  }, []);

  useEffect(() => {
    if (!user) {
      setTeamState(null);
      setTeamLoading(false);
      setTeamError("");
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let current = true;
    setTeamLoading(true);
    setTeamError("");
    void getCurrentTeam(controller.signal)
      .then((state) => {
        if (current) setTeamState(state);
      })
      .catch((cause) => {
        if (current)
          setTeamError(
            cause instanceof Error && cause.name !== "AbortError"
              ? cause.message
              : "Your team could not be loaded. Please refresh.",
          );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (current) setTeamLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [user?.id, teamRevision]);

  useEffect(() => {
    if (
      !authLoading &&
      !teamLoading &&
      !teamError &&
      teamState &&
      tab === "review" &&
      !reviewer
    ) {
      setTab("team", true);
    }
  }, [authLoading, teamLoading, teamError, teamState, reviewer, tab, setTab]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => setTeamRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [user?.id]);

  function teamChanged(state: TeamState) {
    setTeamState(state);
    refreshActivity();
  }

  function inviteAccepted() {
    const url = getTabUrl(new URL(window.location.href), "team");
    if (/^\/join\/[^/]+\/?$/.test(url.pathname)) url.pathname = "/";
    url.searchParams.delete("invite");
    window.history.replaceState(window.history.state, "", url);
  }

  return {
    tab,
    setTab,
    teamState,
    teamLoading,
    teamError,
    reviewer,
    workspaceLoading,
    workspaceError,
    activityRevision,
    refreshActivity,
    refreshTeam,
    teamChanged,
    inviteAccepted,
  };
}
