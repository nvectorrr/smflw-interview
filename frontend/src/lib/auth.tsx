import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true,
  });
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      receivedEvent = true;
      if (active)
        setState({ session, user: session?.user ?? null, loading: false });
    });
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active && !receivedEvent)
          setState({
            session: data.session,
            user: data.session?.user ?? null,
            loading: false,
          });
      })
      .catch(() => {
        if (active && !receivedEvent)
          setState({ session: null, user: null, loading: false });
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error("useAuth must be used inside AuthProvider");
  return state;
}

export async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}
