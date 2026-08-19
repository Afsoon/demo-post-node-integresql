export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.status = status
    this.code = code
    this.details = details
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(404, 'not_found', `${resource} ${id} not found`)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'conflict', message, details)
  }
}

export class DomainValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, 'domain_validation', message, details)
  }
}

export class BillingProviderError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'billing_provider_error', message, details)
  }
}
