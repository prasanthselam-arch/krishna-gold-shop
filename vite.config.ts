import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    port: Number(process.env.UI_PORT || 5173),
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${process.env.PORT || 8787}`,
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
