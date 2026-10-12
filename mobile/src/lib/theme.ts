import { useColorScheme } from "react-native";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

export const light = {
  bg: "#f4f6fb", surface: "#ffffff", surface2: "#f8fafc", surface3: "#eef2f7", border: "#e6eaf1", text: "#0f172a", text2: "#334155",
  muted: "#64748b", faint: "#94a3b8", primary: "#2563eb", primarySoft: "#e8f0ff", up: "#16a34a", upSoft: "#e7f7ee", down: "#ef4444",
  downSoft: "#fdecec", warn: "#f59e0b", warnSoft: "#fff6e5", grid: "#f0f2f7", dark: false,
};
export const dark: typeof light = {
  bg: "#0a0e15", surface: "#111722", surface2: "#151c29", surface3: "#1b2333", border: "#1f2836", text: "#e6ebf3", text2: "#c3cddb",
  muted: "#8b97a8", faint: "#5d6a7d", primary: "#3b82f6", primarySoft: "#16223a", up: "#22c55e", upSoft: "#0f2a1b", down: "#f05252",
  downSoft: "#2d1416", warn: "#fbbf24", warnSoft: "#2b2312", grid: "#182030", dark: true,
};
export type Theme = typeof light;

interface Pref { mode: "system" | "light" | "dark"; set: (m: Pref["mode"]) => void }
export const useThemePref = create<Pref>((set) => ({
  mode: "system",
  set: (mode) => { set({ mode }); SecureStore.setItemAsync("rm.theme", mode).catch(() => {}); },
}));
SecureStore.getItemAsync("rm.theme").then((m) => { if (m === "light" || m === "dark" || m === "system") useThemePref.setState({ mode: m }); }).catch(() => {});

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const mode = useThemePref((s) => s.mode);
  const isDark = mode === "dark" || (mode === "system" && scheme === "dark");
  return isDark ? dark : light;
}
