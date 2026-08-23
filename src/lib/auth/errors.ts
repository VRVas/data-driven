/** Thrown when nobody is signed in - the caller should send them to /login. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("You need to sign in to do that.");
    this.name = "UnauthorizedError";
  }
}

/**
 * Thrown when a signed-in user lacks the permission. The message deliberately
 * never names the permission or confirms the record exists.
 */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function isAuthzError(e: unknown): e is UnauthorizedError | ForbiddenError {
  return e instanceof UnauthorizedError || e instanceof ForbiddenError;
}
