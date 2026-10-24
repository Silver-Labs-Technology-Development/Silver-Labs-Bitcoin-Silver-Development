/**
 * Structured error taxonomy for the BTCS asset service.
 *
 * Every failure that crosses the HTTP boundary is an {@link AssetServiceError} so
 * that clients can branch on a stable machine-readable `code` instead of parsing
 * human-readable messages.
 */

export type AssetServiceErrorCode =
  /** The request body or a request field was malformed. */
  | 'invalid-request'
  /** No image part was present in the multipart body. */
  | 'missing-file'
  /** The request was not `multipart/form-data`. */
  | 'unsupported-media-type'
  /** The detected image format is not an accepted asset image format. */
  | 'unsupported-image-format'
  /** The declared (browser supplied) MIME type contradicts the detected format. */
  | 'content-type-mismatch'
  /** The uploaded file exceeded the configured maximum size. */
  | 'file-too-large'
  /** The multipart request body exceeded the configured maximum size. */
  | 'payload-too-large'
  /** The bytes are not a structurally valid image of the detected format. */
  | 'invalid-image'
  /** The image dimensions are outside the configured bounds. */
  | 'dimensions-out-of-range'
  /** No usable storage provider is configured for this deployment. */
  | 'storage-not-configured'
  /** The storage provider failed to persist the object. */
  | 'storage-failure'
  /** The storage provider could not verify that the stored object matches the upload. */
  | 'storage-verification-failed'
  /** The requested resource does not exist. */
  | 'not-found'
  /** The HTTP method is not allowed for this route. */
  | 'method-not-allowed'
  /** An unexpected internal failure. */
  | 'internal-error'

export type AssetServiceErrorDetails = Readonly<Record<string, unknown>>

export class AssetServiceError extends Error {
  readonly code: AssetServiceErrorCode
  readonly httpStatus: number
  readonly details: AssetServiceErrorDetails

  constructor(
    code: AssetServiceErrorCode,
    message: string,
    httpStatus: number,
    details: AssetServiceErrorDetails = {},
  ) {
    super(message)
    this.name = 'AssetServiceError'
    this.code = code
    this.httpStatus = httpStatus
    this.details = Object.freeze({ ...details })
  }

  toJSON(): { code: AssetServiceErrorCode; message: string; details: AssetServiceErrorDetails } {
    return { code: this.code, message: this.message, details: this.details }
  }

  static invalidRequest(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('invalid-request', message, 400, details)
  }

  static missingFile(message = 'the multipart body contains no image part'): AssetServiceError {
    return new AssetServiceError('missing-file', message, 400)
  }

  static unsupportedMediaType(message: string): AssetServiceError {
    return new AssetServiceError('unsupported-media-type', message, 415)
  }

  static unsupportedImageFormat(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('unsupported-image-format', message, 415, details)
  }

  static contentTypeMismatch(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('content-type-mismatch', message, 415, details)
  }

  static fileTooLarge(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('file-too-large', message, 413, details)
  }

  static payloadTooLarge(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('payload-too-large', message, 413, details)
  }

  static invalidImage(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('invalid-image', message, 422, details)
  }

  static dimensionsOutOfRange(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('dimensions-out-of-range', message, 422, details)
  }

  static storageNotConfigured(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('storage-not-configured', message, 503, details)
  }

  static storageFailure(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('storage-failure', message, 502, details)
  }

  static storageVerificationFailed(message: string, details?: AssetServiceErrorDetails): AssetServiceError {
    return new AssetServiceError('storage-verification-failed', message, 502, details)
  }

  static notFound(message: string): AssetServiceError {
    return new AssetServiceError('not-found', message, 404)
  }

  static methodNotAllowed(message: string): AssetServiceError {
    return new AssetServiceError('method-not-allowed', message, 405)
  }

  static internal(message = 'unexpected internal error'): AssetServiceError {
    return new AssetServiceError('internal-error', message, 500)
  }
}

export function isAssetServiceError(value: unknown): value is AssetServiceError {
  return value instanceof AssetServiceError
}
