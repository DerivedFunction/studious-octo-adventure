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
        chatgpt: resolve(__dirname, "src/script/chatgpt.js"), // your separate file
      },
      output: {
        entryFileNames: (assetInfo) => {
          if (assetInfo.name === "chatgpt") {
            return "script/[name].js"; // output to dist/script/content.js
          }
          return "[name].js";
        },
      },
    },
  },
});
