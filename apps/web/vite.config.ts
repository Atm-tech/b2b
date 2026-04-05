import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@aapoorti-b2b/domain": path.resolve(__dirname, "../../packages/domain/src/index.ts")
    }
  }
});
