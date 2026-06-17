import type { Request, Response, NextFunction } from "express";

/**
 * Security headers middleware for VIBA.
 *
 * Replaces helmet() with explicit header control so the Archibald Titan AI
 * iframe embed works correctly. The key difference from a default helmet setup:
 *   - frame-ancestors includes viba.guru + any CORS_ALLOWED_ORIGINS entries so
 *     the Archibald iframe embed is explicitly permitted.
 *   - X-Frame-Options is intentionally NOT set — it conflicts with frame-ancestors
 *     CSP when the embedding origin is not 'self'. Modern browsers use CSP.
 *   - HSTS is production-only (viba.guru is HTTPS; dev runs on HTTP).
 */
export function securityHeaders() {
  const isProd = process.env.NODE_ENV === "production";

  // Build frame-ancestors from the same allow-list used for CORS
  const extraAncestors = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  const frameAncestors = ["'self'", "https://viba.guru", extraAncestors]
    .filter(Boolean)
    .join(" ");

  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com https://browser.sentry-cdn.com",
    "worker-src 'self' blob:",
    "connect-src 'self' https: wss: blob:",
    "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    `frame-ancestors ${frameAncestors}`,
    "upgrade-insecure-requests",
  ].join("; ");

  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), payment=(self \"https://js.stripe.com\"), usb=(), interest-cohort=()"
    );
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (isProd) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload"
      );
    }
    next();
  };
}
