/** Errors whose message is safe to show to the user. Anything else is logged and replaced with a generic message. */
export class UserError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "UserError";
    this.field = field;
  }
}

export class NotFoundError extends UserError {
  constructor(what = "Record") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends UserError {
  constructor() {
    super("You don't have access to that");
    this.name = "ForbiddenError";
  }
}
