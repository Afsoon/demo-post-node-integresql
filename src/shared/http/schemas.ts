import * as v from 'valibot'

export const ErrorResponseSchema = v.object({
  status: v.number(),
  code: v.string(),
  message: v.string(),
  details: v.optional(v.unknown()),
})

export type ErrorResponse = v.InferOutput<typeof ErrorResponseSchema>

export const UuidSchema = v.pipe(v.string(), v.uuid())

export const IdParamSchema = v.object({ id: UuidSchema })

export const CustomerIdParamSchema = v.object({ customerId: UuidSchema })

export const IsoDateTimeSchema = v.pipe(v.string(), v.isoTimestamp())

export const MetadataSchema = v.record(v.string(), v.union([v.string(), v.number(), v.boolean()]))
