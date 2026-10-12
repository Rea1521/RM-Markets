import { API_URL } from "./config";
import { useAuth } from "../store/auth";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public body?: unknown) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const { refreshToken, setSession, logout } = useAuth.getState();
  if (!refreshToken) return false;
  try {
    const r = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!r.ok) { logout(); return false; }
    setSession(await r.json());
    return true;
  } catch {
    return false;
  }
}

export interface RequestOpts { method?: string; body?: unknown; params?: Record<string, unknown>; signal?: AbortSignal; auth?: boolean }

export async function api<T = any>(path: string, opts: RequestOpts = {}, retried = false): Promise<T> {
  const { method = "GET", body, params, signal, auth = true } = opts;
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString()
    : "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = useAuth.getState().accessToken;
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Network error: cannot reach the RM Markets server.");
  }
  if (res.status === 401 && auth && token && !retried) {
    refreshing = refreshing || refreshTokens().finally(() => (refreshing = null));
    if (await refreshing) return api<T>(path, opts, true);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `Request failed (${res.status})`;
    const retry = res.headers.get("Retry-After");
    throw new ApiError(res.status, res.status === 429 && retry ? `${msg} Try again in ${retry}s.` : String(msg), data?.error, data);
  }
  return data as T;
}

function safeJson(t: string): any {
  try { return JSON.parse(t); } catch { return { detail: t }; }
}

export const get = <T = any>(p: string, params?: Record<string, unknown>) => api<T>(p, { params });
export const post = <T = any>(p: string, body?: unknown, params?: Record<string, unknown>) => api<T>(p, { method: "POST", body: body ?? {}, params });
export const put = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "PUT", body });
export const del = <T = any>(p: string, params?: Record<string, unknown>) => api<T>(p, { method: "DELETE", params });
