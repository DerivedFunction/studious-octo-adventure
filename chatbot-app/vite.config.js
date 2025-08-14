import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"), // your main app entry
        theme: resolve(__dirname, "src/script/theme.js"), // your separate file
        token: resolve(__dirname, "src/script/token.js"), // your separate file
      },
      output: {
        entryFileNames: (assetInfo) => {
          if (["theme", "token"].find((e) => e === assetInfo.name)) {
            return "script/[name].js"; // output to dist/script/content.js
          }
          return "[name].js";
        },
      },
    },
  },
});
