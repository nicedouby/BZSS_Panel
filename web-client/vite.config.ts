import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:12864",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("echarts")) return "vendor-echarts";
            if (id.includes("vue-virtual-scroller")) return "vendor-virtual";
            if (id.includes("@tanstack/vue-query")) return "vendor-query";
            if (id.includes("vue-router") || id.includes("/vue/") || id.includes("pinia")) return "vendor-vue";
          }

          if (id.includes("/src/components/tactical-map/") || id.includes("/src/pages/TacticalMap")) {
            return "tactical-map";
          }

          return undefined;
        },
      },
    },
  },
});

