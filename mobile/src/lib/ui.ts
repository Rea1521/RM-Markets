import { create } from "zustand";

/** Active trading account: null = main, otherwise a competition account id. */
export const useAccountSel = create<{ accountId: number | null; setAccountId: (id: number | null) => void }>((set) => ({
  accountId: null,
  setAccountId: (accountId) => set({ accountId }),
}));

export interface Toast { id: number; kind: "info" | "success" | "error"; title: string; body?: string }
export const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, "id">) => void; dismiss: (id: number) => void }>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.kind === "error" ? 6000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
export const toast = (t: Omit<Toast, "id">) => useToasts.getState().push(t);
