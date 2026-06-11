import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  configLoader: "runner" as any,
  assetsInclude: ["**/*.PNG", "**/*.png", "**/*.JPG", "**/*.jpg", "**/*.JPEG", "**/*.jpeg"],
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
