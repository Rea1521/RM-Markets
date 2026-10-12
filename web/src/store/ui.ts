import { create } from "zustand";

type Theme = "light" | "dark";
export interface Toast { id: number; kind: "info" | "success" | "error"; title: string; body?: string }

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem("rm.theme");
    if (t === "light" || t === "dark") return t;
  } catch { /* ignore */ }
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface UiState {
  theme: Theme;
  toggleTheme: () => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  accountId: number | null; // null = main account, otherwise a competition account
  setAccountId: (id: number | null) => void;
  sidebarOpen: boolean;
  setSidebar: (v: boolean) => void;
}

let nextId = 1;
export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme(),
  toggleTheme: () => {
    const theme = get().theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("rm.theme", theme); } catch { /* ignore */ }
    set({ theme });
  },
  toasts: [],
  toast: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.kind === "error" ? 7000 : 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  accountId: null,
  setAccountId: (accountId) => set({ accountId }),
  sidebarOpen: false,
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
}));

export const toast = (t: Omit<Toast, "id">) => useUi.getState().toast(t);
