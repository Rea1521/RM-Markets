import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import type { Session, User } from "./types";

const KEY = "rm.session";

interface AuthState {
  ready: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  hydrate: () => Promise<void>;
  setSession: (s: Session) => void;
  setUser: (u: User) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  accessToken: null,
  refreshToken: null,
  user: null,
  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) set(JSON.parse(raw));
    } catch { /* keychain unavailable */ }
    set({ ready: true });
  },
  setSession: (s) => {
    set({ accessToken: s.access_token, refreshToken: s.refresh_token, user: s.user ?? get().user });
    persist();
  },
  setUser: (user) => { set({ user }); persist(); },
  logout: () => {
    set({ accessToken: null, refreshToken: null, user: null });
    SecureStore.deleteItemAsync(KEY).catch(() => {});
  },
}));

function persist() {
  const { accessToken, refreshToken, user } = useAuth.getState();
  SecureStore.setItemAsync(KEY, JSON.stringify({ accessToken, refreshToken, user })).catch(() => {});
}
