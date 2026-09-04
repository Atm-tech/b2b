import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on the laptop's LAN interfaces so phones and tablets on the same
    // Wi-Fi can open the development frontend.
    host: true
  },
  resolve: {
    alias: {
      "@aapoorti-b2b/domain": path.resolve(__dirname, "../../packages/domain/src/index.ts")
    }
  }
});
