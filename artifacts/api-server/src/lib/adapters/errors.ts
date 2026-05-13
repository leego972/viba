/**
 * Returns true for errors that are definitively permanent and should not be retried.
 * Permanent errors include authentication failures (401), authorization failures (403),
 * and provider-specific invalid API key messages.
 *
 * We prefer status codes and structured error codes over message-string matching to
 * avoid classifying transient auth-service issues as permanent.
 */
export function isPermanentError(err: unknown): boolean {
  if (err == null) return false;

  if (typeof err === "object") {
    const e = err as Record<string, unknown>;

    const status = typeof e["status"] === "number" ? e["status"] : undefined;
    if (status === 401 || status === 403) return true;

    const statusCode = typeof e["statusCode"] === "number" ? e["statusCode"] : undefined;
    if (statusCode === 401 || statusCode === 403) return true;

    const code = typeof e["code"] === "string" ? e["code"].toLowerCase() : "";
    if (
      code === "invalid_api_key" ||
      code === "authentication_error" ||
      code === "permission_denied" ||
      code === "api_key_invalid" ||
      code === "unauthorized"
    ) {
      return true;
    }

    const message = typeof e["message"] === "string" ? e["message"].toLowerCase() : "";
    if (
      message.includes("invalid api key") ||
      message.includes("incorrect api key") ||
      message.includes("api key not found") ||
      message.includes("no api key provided") ||
      message.includes("invalid_api_key")
    ) {
      return true;
    }
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("invalid api key") ||
      msg.includes("incorrect api key") ||
      msg.includes("api key not found") ||
      msg.includes("no api key provided") ||
      msg.includes("invalid_api_key")
    ) {
      return true;
    }
  }

  return false;
}
