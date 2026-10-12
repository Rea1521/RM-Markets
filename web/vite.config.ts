/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_API_URL: backend origin (e.g. https://rm-markets-api.up.railway.app). Empty = same origin / dev proxy.
// VITE_CDN_URL: optional CDN origin for hashed static assets.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: process.env.VITE_CDN_URL ? `${process.env.VITE_CDN_URL.replace(/\/$/, "")}/` : "/",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/graphql": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  build: {
    sourcemap: mode !== "production",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { charts: ["lightweight-charts"], react: ["react", "react-dom", "react-router-dom"] } },
    },
  },
  test: { environment: "jsdom" },
}));
