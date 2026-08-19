import type { GenericSchema } from 'valibot'
import { describeRoute, resolver, validator as openapiValidator } from 'hono-openapi'
import type { ValidationTargets } from 'hono'
import { ErrorResponseSchema } from './schemas.ts'

const errorContent = { 'application/json': { schema: resolver(ErrorResponseSchema) } }

export const errorResponses = {
  400: { description: 'Request validation failed', content: errorContent },
  401: { description: 'Missing or invalid bearer token', content: errorContent },
  404: { description: 'Resource not found', content: errorContent },
  409: { description: 'Conflict', content: errorContent },
  422: { description: 'Domain rule violated', content: errorContent },
  502: { description: 'Billing provider error', content: errorContent },
}

export function jsonResponse(description: string, schema: GenericSchema) {
  return { description, content: { 'application/json': { schema: resolver(schema) } } }
}

export const noContent = { description: 'No content' }

/**
 * Thin wrapper around hono-openapi's validator (itself built on @hono/standard-validator):
 * registers the schema in the OpenAPI document and normalizes validation failures
 * to the shared error response shape.
 */
export function validate<S extends GenericSchema, T extends keyof ValidationTargets>(target: T, schema: S) {
  return openapiValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          status: 400,
          code: 'validation_error',
          message: `Invalid request ${result.target}`,
          details: result.error.map((issue) => ({
            path: issue.path?.map((p) => (typeof p === 'object' ? p.key : p)),
            message: issue.message,
          })),
        },
        400,
      )
    }
  })
}

export { describeRoute, resolver }
