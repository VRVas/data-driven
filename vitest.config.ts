import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Neutralise the RSC "server-only" guard so stores can be unit-tested in Node.
      "server-only": `${root}test/stubs/server-only.ts`,
      // NextAuth pulls in `next/server`, which does not resolve under plain Node.
      // Must precede the "@" prefix alias - first match wins.
      "@/auth": `${root}test/stubs/auth.ts`,
      "@": `${root}src`,
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
