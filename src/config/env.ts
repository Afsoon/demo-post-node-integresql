import * as v from 'valibot'

const EnvSchema = v.pipe(
  v.object({
    PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)), '3000'),
    DATABASE_URL: v.pipe(v.string(), v.url()),
    /** Shared secret for the Bearer auth middleware protecting every API route. */
    API_TOKEN: v.pipe(v.string(), v.minLength(16)),
    POLAR_ACCESS_TOKEN: v.optional(v.pipe(v.string(), v.trim())),
    POLAR_ENVIRONMENT: v.optional(v.picklist(['sandbox', 'production']), 'sandbox'),
    /** One-time Polar product used as line item of off-session usage orders. Required with a token. */
    POLAR_PRODUCT_ID: v.optional(v.pipe(v.string(), v.trim())),
  }),
  v.forward(
    v.check((env) => !env.POLAR_ACCESS_TOKEN || !!env.POLAR_PRODUCT_ID, 'required when POLAR_ACCESS_TOKEN is set'),
    ['POLAR_PRODUCT_ID'],
  ),
)

export type Env = v.InferOutput<typeof EnvSchema>

export function loadEnv(source: Record<string, string | undefined> = process.env) {
  const result = v.safeParse(EnvSchema, source)
  if (!result.success) {
    const issues = v.flatten(result.issues).nested ?? {}
    const lines = Object.entries(issues).map(([key, msgs]) => `  ${key}: ${msgs?.join(', ')}`)
    throw new Error(`Invalid environment:\n${lines.join('\n')}`)
  }
  return result.output
}
