import * as v from 'valibot'
import { DomainValidationError } from '../errors.ts'

/**
 * Validates/normalizes domain state with a valibot schema.
 * Invariant violations surface as DomainValidationError (HTTP 422) with the flattened issues.
 */
export function parseEntity<S extends v.GenericSchema>(schema: S, input: unknown) {
  const result = v.safeParse(schema, input)
  if (!result.success) {
    const first = result.issues[0]
    const path = first.path?.map((p) => String(p.key)).join('.')
    throw new DomainValidationError(path ? `${path}: ${first.message}` : first.message, {
      issues: v.flatten(result.issues),
    })
  }
  return result.output
}

export const MetadataSchema = v.pipe(
  v.record(v.string(), v.union([v.string(), v.number(), v.boolean()])),
  v.maxEntries(50, 'metadata supports at most 50 keys'),
)
