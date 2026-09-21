import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        headers: { origin: "http://127.0.0.1:3000" },
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
