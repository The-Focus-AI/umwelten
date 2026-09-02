import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        "account-authentication": resolve(
          import.meta.dirname,
          "src/account-authentication.js",
        ),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "account-authentication"
            ? "assets/account-authentication.js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
