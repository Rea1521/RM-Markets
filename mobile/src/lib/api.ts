import { API_URL } from "./config";
import { useAuth } from "./auth";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const { refreshToken, setSession, logout } = useAuth.getState();
  if (!refreshToken) return false;
  try {
    const r = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }) });
    if (!r.ok) { logout(); return false; }
    setSession(await r.json());
    return true;
  } catch { return false; }
}

export interface Opts { method?: string; body?: unknown; params?: Record<string, unknown>; auth?: boolean }

export async function api<T = any>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const { method = "GET", body, params, auth = true } = opts;
  const qs = params
    ? "?" + Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
    : "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = useAuth.getState().accessToken;
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal });
  } catch {
    throw new ApiError(0, `Can't reach the RM Markets server (${API_URL}). Check your connection.`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && auth && token && !retried) {
    refreshing = refreshing || refresh().finally(() => (refreshing = null));
    if (await refreshing) return api<T>(path, opts, true);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
  if (!res.ok) throw new ApiError(res.status, String(data?.detail || data?.error || `Request failed (${res.status})`), data?.error);
  return data as T;
}

export const get = <T = any>(p: string, params?: Record<string, unknown>) => api<T>(p, { params });
export const post = <T = any>(p: string, body?: unknown, params?: Record<string, unknown>) => api<T>(p, { method: "POST", body: body ?? {}, params });
export const del = <T = any>(p: string, params?: Record<string, unknown>) => api<T>(p, { method: "DELETE", params });
