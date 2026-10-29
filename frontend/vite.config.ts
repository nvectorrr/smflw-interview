import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const env = { ...loadEnv(mode, root, ""), ...process.env };

  return {
    plugins: [react()],
    envDir: root,
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "",
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? "",
      ),
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/openapi.json": "http://127.0.0.1:8000",
        "/api": {
          target: "http://127.0.0.1:8000",
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
