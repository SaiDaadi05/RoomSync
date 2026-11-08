/** Errors thrown by the service layer. Messages are safe to show to users. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "CONFLICT" | "UNAUTHENTICATED" = "INVALID",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Item") => new AppError(`${what} not found`, "NOT_FOUND");
export const forbidden = (msg = "You don't have access to that") => new AppError(msg, "FORBIDDEN");
export const invalid = (msg: string) => new AppError(msg, "INVALID");
