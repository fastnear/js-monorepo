export class TransportError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  readonly details?: unknown;

  constructor(code: string, message: string, options?: { cause?: unknown; details?: unknown }) {
    super(message);
    this.name = "TransportError";
    this.code = code;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

export class UserRejectedError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  readonly details?: unknown;

  constructor(code: string, message: string, options?: { cause?: unknown; details?: unknown }) {
    super(message);
    this.name = "UserRejectedError";
    this.code = code;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

export const isUserRejectedError = (error: unknown): error is UserRejectedError => {
  return error instanceof UserRejectedError;
};

export const isTransportError = (error: unknown): error is TransportError => {
  return error instanceof TransportError;
};
