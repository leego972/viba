import type { Request, Response, NextFunction } from "express";

function parseHttpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function securityHeaders() {
  const isProd = process.env.NODE_ENV === "production";
  const configuredAncestors = (process.env.FRAME_ANCESTORS ?? process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => parseHttpsOrigin(value.trim()))
    .filter((value): value is string => Boolean(value));

  const frameAncestors = [
    "'self'",
    "https://viba.guru",
    "https://www.viba.guru",
    ...configuredAncestors,
  ].filter((value, index, values) => values.indexOf(value) === index).join(" ");

  const directives = [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' https://js.stripe.com https://checkout.stripe.com",
    "worker-src 'self' blob:",
    "connect-src 'self' https://api.stripe.com https://*.ingest.sentry.io wss:",
    "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    `frame-ancestors ${frameAncestors}`,
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ];

  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", directives.join("; "));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), geolocation=(), microphone=(), payment=(self), usb=()",
    );
    if (isProd) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    }
    next();
  };
}
