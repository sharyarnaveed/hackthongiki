export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message = 'Bad request', details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message = 'Conflict') => new HttpError(409, 'CONFLICT', message);
export const payloadTooLarge = (message = 'Payload too large') =>
  new HttpError(413, 'PAYLOAD_TOO_LARGE', message);
