import { createPolar, type Environment } from '@polar-sh/sdk/2026-04'

export function createPolarClient(options: { accessToken: string; environment: Environment }) {
  return createPolar(options)
}

export type PolarClient = ReturnType<typeof createPolarClient>
