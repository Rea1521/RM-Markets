import { create } from "zustand";
import type { Session, User } from "../lib/types";

const KEY = "rm.session";

function load(): Partial<State> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

interface State {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setSession: (s: Session) => void;
  setUser: (u: User) => void;
  logout: () => void;
}

export const useAuth = create<State>((set, get) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  ...load(),
  setSession: (s) => {
    set({ accessToken: s.access_token, refreshToken: s.refresh_token, user: s.user ?? get().user });
    persist(get());
  },
  setUser: (u) => { set({ user: u }); persist(get()); },
  logout: () => {
    set({ accessToken: null, refreshToken: null, user: null });
    try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  },
}));

function persist(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }));
  } catch { /* private mode etc. */ }
}
