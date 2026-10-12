import Constants from "expo-constants";

/**
 * API base URL resolution:
 * 1. EXPO_PUBLIC_API_URL (set in .env or EAS env), e.g. https://rm-markets-api.up.railway.app
 * 2. In development, the machine running `expo start` on port 8000 (works on a physical phone on the same Wi-Fi)
 */
function devHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;
  if (!hostUri) return null;
  return `http://${hostUri.split(":")[0]}:8000`;
}

export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL || devHost() || "http://localhost:8000").replace(/\/$/, "");
export const WS_URL: string = process.env.EXPO_PUBLIC_WS_URL || API_URL.replace(/^http/, "ws") + "/ws";
