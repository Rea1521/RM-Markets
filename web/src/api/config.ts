const env = import.meta.env;
export const API_URL: string = (env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";
export const WS_URL: string = (() => {
  if (env.VITE_WS_URL) return env.VITE_WS_URL as string;
  if (API_URL) return API_URL.replace(/^http/, "ws") + "/ws";
  if (typeof window === "undefined") return "ws://localhost:8000/ws";
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
})();
export const GOOGLE_CLIENT_ID: string | undefined = env.VITE_GOOGLE_CLIENT_ID as string | undefined;
