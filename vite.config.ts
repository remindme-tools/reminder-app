import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// BASE_PATH is "/reminder-app/" on GitHub Pages, "/" everywhere else.
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Remind Me",
        short_name: "Remind Me",
        description: "Never forget renewals, expiries and repeating tasks.",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: { include: ["src/**/*.test.ts", "supabase/**/*.test.ts"] },
});
