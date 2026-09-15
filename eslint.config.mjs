import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Domain boundaries are enforced here, not by convention.
 *
 * The single most valuable property of this codebase is that Trading, Finance,
 * SentryOps and Life cannot quietly grow into each other. A cross-domain import
 * is how that erosion starts, so it is a lint error. Domains communicate
 * upward through the Event Engine and World State (see docs/ARCHITECTURE.md).
 */
const layerBoundaries = [
  {
    // Core is the executive layer: pure domain logic, no I/O, no React, and no
    // knowledge of any specific domain's internals.
    files: ["src/core/**/*.ts", "src/core/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/domains/*", "@/domains/**"],
              message:
                "Core must not depend on a specific domain. Domains depend on core, never the reverse.",
            },
            {
              group: ["@/app/*", "@/app/**", "@/components/*", "@/components/**"],
              message: "Core must not depend on the UI layer.",
            },
            {
              group: ["@/server/*", "@/server/**"],
              message:
                "Core must stay I/O-free. Declare a port (interface) in core and implement the adapter in src/server.",
            },
            {
              group: ["next/*", "next", "react", "react-dom"],
              message: "Core must remain framework-agnostic so it stays testable and portable.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/core/**", "@/domains/**", "@/server/**", "@/app/**", "@/components/**"],
              message: "src/lib is the lowest layer: it may not import from any layer above it.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.tsx", "src/components/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/**"],
              message:
                "Components must not reach the database directly. Fetch in a Server Component or service and pass data down as props.",
            },
          ],
        },
      ],
    },
  },
  // Each domain is a sibling island. It may import core and lib; never another domain.
  ...["trading", "finance", "sentryops", "life"].map((domain) => ({
    files: [`src/domains/${domain}/**/*.ts`, `src/domains/${domain}/**/*.tsx`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["trading", "finance", "sentryops", "life"]
                .filter((other) => other !== domain)
                .flatMap((other) => [`@/domains/${other}`, `@/domains/${other}/**`]),
              message:
                "Domains are isolated. Cross-domain facts travel upward as events or world-state slices, read by Jarvis Core.",
            },
            {
              group: ["@/app/**", "@/components/**"],
              message: "Domain logic must not depend on the UI layer.",
            },
          ],
        },
      ],
    },
  })),
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  ...layerBoundaries,
  {
    // Tests are the one place a core module legitimately meets a real adapter:
    // wiring the in-memory repositories is how the engines get exercised
    // end-to-end without a database. The production rule above still applies to
    // every non-test file in src/core.
    files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**"]),
]);

export default eslintConfig;
