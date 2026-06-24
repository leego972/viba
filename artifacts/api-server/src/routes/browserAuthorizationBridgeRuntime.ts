export type BrowserAuthorizationStatus =
  | "running"
  | "resuming"
  | "waiting_for_oauth"
  | "waiting_for_2fa"
  | "waiting_for_passkey"
  | "waiting_for_email_link"
  | "waiting_for_captcha"
  | "waiting_for_manual_approval"
  | "waiting_for_payment_approval"
  | "authorization_expired"
  | "completed"
  | "failed"
  | "cancelled";

export type BrowserAuthorizationType =
  | "oauth"
  | "2fa"
  | "passkey"
  | "email_link"
  | "captcha"
  | "manual_approval"
  | "payment_approval";

export type BrowserCreditState = "consuming" | "paused_waiting_for_user" | "stopped";

export const AUTHORIZATION_TIMEOUTS_MS: Record<BrowserAuthorizationType, number> = {
  "2fa": 10 * 60 * 1000,
  oauth: 15 * 60 * 1000,
  passkey: 10 * 60 * 1000,
  email_link: 20 * 60 * 1000,
  captcha: 15 * 60 * 1000,
  manual_approval: 24 * 60 * 60 * 1000,
  payment_approval: 24 * 60 * 60 * 1000,
};

export const WAITING_STATUS_BY_TYPE: Record<BrowserAuthorizationType, BrowserAuthorizationStatus> = {
  oauth: "waiting_for_oauth",
  "2fa": "waiting_for_2fa",
  passkey: "waiting_for_passkey",
  email_link: "waiting_for_email_link",
  captcha: "waiting_for_captcha",
  manual_approval: "waiting_for_manual_approval",
  payment_approval: "waiting_for_payment_approval",
};

export function creditStateForStatus(status: BrowserAuthorizationStatus): BrowserCreditState {
  if (status === "running" || status === "resuming") return "consuming";
  if (status.startsWith("waiting_for_")) return "paused_waiting_for_user";
  return "stopped";
}

export function expiresAtFor(type: BrowserAuthorizationType, nowMs = Date.now()): string {
  return new Date(nowMs + AUTHORIZATION_TIMEOUTS_MS[type]).toISOString();
}

export function isWaitingStatus(status: string): boolean {
  return status.startsWith("waiting_for_");
}

export function isValidAuthorizationType(value: unknown): value is BrowserAuthorizationType {
  return typeof value === "string" && Object.keys(WAITING_STATUS_BY_TYPE).includes(value);
}

export function redactBrowserMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/pass|code|token|secret|cookie|key|credential/i.test(key)) {
      redacted[key] = "REDACTED";
    } else if (typeof value === "string" && value.length > 120) {
      redacted[key] = `${value.slice(0, 80)}…`;
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function shouldPauseForReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  const validSignals = [
    "oauth",
    "2fa",
    "two factor",
    "verification code",
    "passkey",
    "webauthn",
    "email link",
    "magic link",
    "captcha",
    "manual approval",
    "payment approval",
    "billing confirmation",
    "terms",
    "consent",
  ];
  return validSignals.some((signal) => normalized.includes(signal));
}

export function shouldRetryInsteadOfPause(reason: string): boolean {
  const normalized = reason.toLowerCase();
  const retrySignals = [
    "timeout",
    "slow network",
    "page load",
    "missing selector",
    "not found",
    "transient",
    "retryable",
    "navigation",
    "dashboard search",
  ];
  return retrySignals.some((signal) => normalized.includes(signal)) && !shouldPauseForReason(reason);
}
