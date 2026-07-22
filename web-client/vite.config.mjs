import { createReadStream } from "node:fs";
import { access, cp, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { rollupRuntimeGuard } from "./scripts/rollup-runtime-guard.mjs";

const mapSceneDirectory = fileURLToPath(new URL("../MapScene/", import.meta.url));
const contentTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function mapSceneAssets() {
  let outDir = "";

  return {
    name: "bzss-map-scene-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use("/MapScene", async (request, response, next) => {
        const pathname = decodeURIComponent(String(request.url ?? "/").split("?")[0]);
        const filePath = resolve(mapSceneDirectory, `.${pathname}`);
        const rootWithSeparator = mapSceneDirectory.endsWith(sep)
          ? mapSceneDirectory
          : `${mapSceneDirectory}${sep}`;

        if (!filePath.startsWith(rootWithSeparator)) {
          next();
          return;
        }

        try {
          const info = await stat(filePath);
          if (!info.isFile()) {
            next();
            return;
          }

          response.setHeader("Content-Type", contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream");
          createReadStream(filePath).pipe(response);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      try {
        await access(mapSceneDirectory);
        await cp(mapSceneDirectory, resolve(outDir, "MapScene"), {
          recursive: true,
          force: true,
        });
      } catch {
        // MapScene is an optional local art directory and is intentionally not required in Git.
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), mapSceneAssets(), rollupRuntimeGuard()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8899",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
