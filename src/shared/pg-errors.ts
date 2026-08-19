import { DrizzleQueryError } from 'drizzle-orm'

const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

function pgCode(error: unknown) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error
  return typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined
}

export function isUniqueViolation(error: unknown) {
  return pgCode(error) === UNIQUE_VIOLATION
}

export function isForeignKeyViolation(error: unknown) {
  return pgCode(error) === FOREIGN_KEY_VIOLATION
}
