import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, siteRoot, "");
  const clientDevPort = Number.parseInt(loadedEnv.CLIENT_DEV_PORT ?? process.env.CLIENT_DEV_PORT ?? "5173", 10);
  const apiDevPort = Number.parseInt(loadedEnv.PORT ?? process.env.PORT ?? "3001", 10);
  const apiTarget =
    loadedEnv.VITE_DEV_API_ORIGIN?.trim() ||
    `http://localhost:${Number.isFinite(apiDevPort) ? apiDevPort : 3001}`;

  return {
    envDir: siteRoot,
    envPrefix: ["VITE_", "SECONDARY_RPC_NODE"],
    resolve: {
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
        "react-dom/test-utils": "preact/test-utils",
        "react/jsx-runtime": "preact/jsx-runtime",
      },
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "preact",
    },
    server: {
      port: Number.isFinite(clientDevPort) ? clientDevPort : 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/socket.io": {
          target: apiTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
