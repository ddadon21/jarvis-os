import { defineConfig } from "vitest/config";

export default defineConfig({
  // Path aliases (`@/*`) are resolved natively from tsconfig.json.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
