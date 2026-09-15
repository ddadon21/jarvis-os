import { z } from "zod";

/**
 * Environment validation.
 *
 * Rule: nothing in the codebase reads `process.env` directly. Everything goes
 * through here, so a missing or malformed variable fails loudly at the boundary
 * instead of surfacing as `undefined` three layers deep inside a money
 * calculation.
 *
 * Server and client schemas are separate on purpose. The client schema can only
 * contain `NEXT_PUBLIC_*` values; anything else would be bundled into the
 * browser payload. See docs/SECURITY.md.
 */

const appEnvSchema = z.enum(["development", "preview", "production"]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

/** Where domain data is read from. See docs/ARCHITECTURE.md ("Data sources"). */
export const dataSourceSchema = z.enum(["dev", "supabase"]);
export type DataSource = z.infer<typeof dataSourceSchema>;

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.union([z.url(), z.literal("")]).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

const serverSchema = z
  .object({
    APP_ENV: appEnvSchema.default("development"),
    LOG_LEVEL: logLevelSchema.default("info"),
    JARVIS_DATA_SOURCE: dataSourceSchema.default("dev"),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
  })
  .extend(clientSchema.shape)
  .superRefine((env, ctx) => {
    if (env.JARVIS_DATA_SOURCE !== "supabase") return;

    // Refusing to boot is the right behaviour here: a half-configured Supabase
    // connection would silently fall back to empty reads, which in this system
    // looks identical to "you have no debt and no open trades".
    if (!env.NEXT_PUBLIC_SUPABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_URL"],
        message: "Required when JARVIS_DATA_SOURCE=supabase",
      });
    }
    if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
        message: "Required when JARVIS_DATA_SOURCE=supabase",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;

function format(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

let cachedServerEnv: ServerEnv | undefined;

/**
 * Validated server environment. Throws on the first call if config is invalid.
 * Never call this from a Client Component — the secrets are not there and the
 * failure mode would be confusing.
 */
export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment.\n${format(parsed.error)}\n\nSee .env.example for the expected shape.`,
    );
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

let cachedClientEnv: ClientEnv | undefined;

/** Validated public environment. Safe in the browser. */
export function clientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;

  // Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when the
  // property is referenced statically, so the keys are spelled out rather than
  // read from a loop.
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    throw new Error(`Invalid public environment.\n${format(parsed.error)}`);
  }
  cachedClientEnv = parsed.data;
  return cachedClientEnv;
}

/** True when the app is running against real Supabase data. */
export function isLiveData(): boolean {
  return serverEnv().JARVIS_DATA_SOURCE === "supabase";
}
