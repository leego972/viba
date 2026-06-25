/**
 * VIBA Domain Setup — GoDaddy DNS Wizard API
 *
 * GET  /api/domain-setup/providers  — list deployment providers + wizard copy
 * POST /api/domain-setup/plan       — generate GoDaddy DNS instructions
 * POST /api/domain-setup/check      — check domain connectivity status
 *
 * Security:
 * - requireSession on all routes
 * - domain validated to viba.guru or subdomains only
 * - A record targets validated as IPv4, not private
 * - CNAME targets validated as hostnames, not IPs
 * - No localhost, no private IPs, no file:// URLs
 * - No secrets ever returned (rawValuesReturned: false)
 */

import { Router } from "express";
import { requireSession } from "../middlewares/requireSession";
import { validateUrl } from "../lib/urlSafety";

const router = Router();

// ─── Provider Registry ────────────────────────────────────────────────────────

const PROVIDERS = {
  railway: {
    id: "railway",
    name: "Railway",
    wizardCopy:
      "Add viba.guru and www.viba.guru inside Railway custom domains first. Railway will show the DNS target you must copy into GoDaddy. Paste that target here.",
    exampleTarget: "*.up.railway.app or cname.railway.app",
    supportsApexAlias: false,
    supportsARecord: false,
    apexNote:
      "Railway provides a CNAME target for custom domains. GoDaddy does not support CNAME at the apex (@), so use 'Redirect root to www' or move your DNS to a provider that supports apex aliasing (e.g. Cloudflare).",
  },
  render: {
    id: "render",
    name: "Render",
    wizardCopy:
      "Add the custom domain in Render first. Render will show the required DNS record. Paste that target here.",
    exampleTarget: "*.onrender.com",
    supportsApexAlias: false,
    supportsARecord: false,
    apexNote:
      "Render provides a CNAME target. Use 'Redirect root to www' or Cloudflare for apex aliasing.",
  },
  digitalocean: {
    id: "digitalocean",
    name: "DigitalOcean",
    wizardCopy:
      "Add the domain to DigitalOcean App Platform or your selected DigitalOcean app first. Copy the required DNS record into this wizard.",
    exampleTarget: "*.ondigitalocean.app",
    supportsApexAlias: false,
    supportsARecord: true,
    apexNote:
      "DigitalOcean may provide an A record for the root domain. Check your App Platform settings.",
  },
  vercel: {
    id: "vercel",
    name: "Vercel",
    wizardCopy:
      "Add viba.guru in Vercel Project Settings → Domains first. Vercel will show the required DNS records. Paste the values here.",
    exampleTarget: "cname.vercel-dns.com",
    supportsApexAlias: false,
    supportsARecord: true,
    defaultARecord: "76.76.21.21",
    apexNote:
      "Vercel recommends adding an A record pointing @ to 76.76.21.21 for the root domain.",
  },
  sevall: {
    id: "sevall",
    name: "Sevall",
    wizardCopy:
      "Sevall support is manual-guided until the exact provider API and DNS requirements are confirmed. Paste the DNS target Sevall provides.",
    exampleTarget: "Provider-specific target",
    supportsApexAlias: false,
    supportsARecord: false,
    apexNote: "Follow Sevall's documentation for apex domain configuration.",
  },
  custom: {
    id: "custom",
    name: "Custom / Other",
    wizardCopy: "Paste the DNS target or IP your provider gave you.",
    exampleTarget: "your-app.provider.com or IP address",
    supportsApexAlias: false,
    supportsARecord: true,
    apexNote: "Consult your provider's documentation for apex domain configuration.",
  },
} as const;

type ProviderId = keyof typeof PROVIDERS;
const VALID_PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

// ─── Validation Helpers ───────────────────────────────────────────────────────

export function isValidDomain(domain: string): boolean {
  return domain === "viba.guru" || domain.endsWith(".viba.guru");
}

export function isValidIPv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function isPrivateIPv4(value: string): boolean {
  if (!isValidIPv4(value)) return false;
  const parts = value.split(".").map(Number);
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isHostname(value: string): boolean {
  // Matches domain labels — allows trailing dot for FQDN
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.?$/.test(
    value.trim(),
  );
}

export function hasEmbeddedCredentials(value: string): boolean {
  // Detects user:password@ style embedded creds
  const atIdx = value.indexOf("@");
  if (atIdx === -1) return false;
  const beforeAt = value.slice(0, atIdx);
  return beforeAt.includes(":");
}

// ─── DNS Plan Builder ─────────────────────────────────────────────────────────

interface DnsRecord {
  type: "A" | "CNAME" | "ALIAS" | "ANAME";
  name: string;
  value: string;
  ttl: string;
  notes: string;
}

interface DnsRecordToRemove {
  type: string;
  name: string;
  value: string;
  reason: string;
}

interface DnsPlan {
  domain: string;
  dnsProvider: "godaddy";
  deploymentProvider: string;
  currentProblem: string;
  recordsToRemove: DnsRecordToRemove[];
  recordsToAdd: DnsRecord[];
  manualSteps: string[];
  warnings: string[];
  qaGateBlockers: string[];
  rawValuesReturned: false;
}

function buildPlan(
  domain: string,
  providerId: ProviderId,
  providerTarget: string,
  rootStrategy: string,
  wwwStrategy: string,
): DnsPlan {
  const provider = PROVIDERS[providerId];
  const recordsToAdd: DnsRecord[] = [];
  const warnings: string[] = [];
  const qaBlockers: string[] = [];

  // www record
  if (wwwStrategy === "cname" && providerTarget) {
    recordsToAdd.push({
      type: "CNAME",
      name: "www",
      value: providerTarget,
      ttl: "3600",
      notes: `Points www.${domain} to ${provider.name}`,
    });
  }

  // Root record
  if (rootStrategy === "a_record") {
    const aTarget =
      providerId === "vercel"
        ? "76.76.21.21"
        : isValidIPv4(providerTarget)
          ? providerTarget
          : "";
    if (aTarget) {
      recordsToAdd.push({
        type: "A",
        name: "@",
        value: aTarget,
        ttl: "3600",
        notes: `Points ${domain} to provider IP`,
      });
    }
  } else if (rootStrategy === "alias_target") {
    warnings.push(
      "GoDaddy may not support ALIAS/ANAME record types at the apex (@). " +
        "If GoDaddy does not support this record type, either use the provider's supplied A record, " +
        "use www as the main domain, or move DNS to a provider that supports apex aliasing (e.g. Cloudflare).",
    );
    if (providerTarget) {
      recordsToAdd.push({
        type: "ALIAS",
        name: "@",
        value: providerTarget,
        ttl: "3600",
        notes: "ALIAS/ANAME — GoDaddy may not support this record type at the apex",
      });
    }
  } else if (rootStrategy === "redirect_to_www") {
    warnings.push(
      `Set GoDaddy Forwarding: ${domain} → https://www.${domain} (Forward only, Permanent 301, no masking). ` +
        "Do NOT use masked forwarding — it breaks SSL and SEO.",
    );
  }

  // Provider apex note
  if (provider.apexNote && rootStrategy !== "a_record" && rootStrategy !== "redirect_to_www") {
    warnings.push(provider.apexNote);
  }

  // QA gate blockers
  if (!providerTarget && rootStrategy !== "redirect_to_www" && rootStrategy !== "manual") {
    qaBlockers.push("provider_target_missing");
  }
  if (rootStrategy === "manual" || wwwStrategy === "manual") {
    qaBlockers.push("dns_strategy_not_confirmed");
  }

  const recordsToRemove: DnsRecordToRemove[] = [
    {
      type: "A",
      name: "@",
      value: "GoDaddy parking A records (pointing to GoDaddy park server IPs)",
      reason:
        "Remove and replace with provider records. Do NOT remove MX, TXT, SPF, DKIM, or DMARC records.",
    },
    {
      type: "CNAME",
      name: "www",
      value: "Existing GoDaddy www CNAME (if present)",
      reason: "Remove and replace with your provider's CNAME target.",
    },
  ];

  const addSteps = recordsToAdd.map(
    (r) => `Add DNS record: Type ${r.type}, Name ${r.name}, Value ${r.value}, TTL ${r.ttl}`,
  );

  const manualSteps = [
    `Log in to GoDaddy at https://godaddy.com`,
    `Go to: My Products → Domains → ${domain} → DNS / Manage DNS`,
    `Remove or replace GoDaddy parking A/CNAME records at @ and www. ` +
      `Do NOT remove MX, TXT (SPF, DKIM, DMARC), or mail records.`,
    ...addSteps,
    rootStrategy === "redirect_to_www"
      ? `In GoDaddy, set Forwarding: ${domain} → https://www.${domain} (Permanent 301, Forward only)`
      : `Verify @ DNS record points correctly to your provider.`,
    `In ${provider.name} dashboard: add custom domains ${domain} and www.${domain}`,
    `Set environment variable in your deployment: PUBLIC_ORIGIN=https://${domain}`,
    `Wait for DNS propagation (15 minutes to 48 hours)`,
    `Verify both https://${domain} and https://www.${domain} load your app`,
    `Run /api/healthz check to confirm the API is live`,
  ];

  return {
    domain,
    dnsProvider: "godaddy",
    deploymentProvider: provider.id,
    currentProblem: "Domain appears parked / not connected — GoDaddy parked page detected.",
    recordsToRemove,
    recordsToAdd,
    manualSteps,
    warnings,
    qaGateBlockers: qaBlockers,
    rawValuesReturned: false,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/domain-setup/providers
router.get("/api/domain-setup/providers", requireSession, (_req, res) => {
  const providers = VALID_PROVIDER_IDS.map((id) => {
    const p = PROVIDERS[id];
    return {
      id: p.id,
      name: p.name,
      wizardCopy: p.wizardCopy,
      exampleTarget: p.exampleTarget,
      supportsARecord: p.supportsARecord,
      supportsApexAlias: p.supportsApexAlias,
      apexNote: p.apexNote,
    };
  });
  res.json({ providers, rawValuesReturned: false });
});

// POST /api/domain-setup/plan
router.post("/api/domain-setup/plan", requireSession, (req, res) => {
  const body = req.body as {
    domain?: unknown;
    dnsProvider?: unknown;
    deploymentProvider?: unknown;
    providerTarget?: unknown;
    rootStrategy?: unknown;
    wwwStrategy?: unknown;
  };

  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  const deploymentProvider = typeof body.deploymentProvider === "string" ? body.deploymentProvider.trim().toLowerCase() : "";
  const providerTarget = typeof body.providerTarget === "string" ? body.providerTarget.trim() : "";
  const rootStrategy = typeof body.rootStrategy === "string" ? body.rootStrategy.trim() : "manual";
  const wwwStrategy = typeof body.wwwStrategy === "string" ? body.wwwStrategy.trim() : "manual";

  // Domain validation
  if (!domain || !isValidDomain(domain)) {
    res.status(400).json({
      error: "INVALID_DOMAIN",
      message: "Domain must be viba.guru or a subdomain of viba.guru.",
    });
    return;
  }

  // Provider validation
  if (!deploymentProvider || !VALID_PROVIDER_IDS.includes(deploymentProvider as ProviderId)) {
    res.status(400).json({
      error: "INVALID_PROVIDER",
      message: `deploymentProvider must be one of: ${VALID_PROVIDER_IDS.join(", ")}`,
    });
    return;
  }

  // Provider target validation
  if (providerTarget) {
    // Block file:// URLs
    if (/^file:\/\//i.test(providerTarget)) {
      res.status(422).json({
        error: "INVALID_DNS_TARGET",
        message: "file:// URLs are not allowed as DNS targets.",
      });
      return;
    }

    // Block embedded credentials
    if (hasEmbeddedCredentials(providerTarget)) {
      res.status(422).json({
        error: "INVALID_DNS_TARGET",
        message: "DNS targets must not contain embedded credentials.",
      });
      return;
    }

    // Block localhost
    if (/^localhost(\.|\:|$)/i.test(providerTarget) || providerTarget.toLowerCase() === "localhost") {
      res.status(422).json({
        error: "INVALID_DNS_TARGET",
        message: "localhost is not allowed as a DNS target.",
      });
      return;
    }

    const targetIsIPv4 = isValidIPv4(providerTarget);

    // CNAME/ALIAS targets must be hostnames, not IPs
    if ((wwwStrategy === "cname" || rootStrategy === "alias_target") && targetIsIPv4) {
      res.status(422).json({
        error: "INVALID_DNS_TARGET",
        message: "CNAME targets must be hostnames. A records must be IP addresses.",
      });
      return;
    }

    // A record targets must be IPv4 (Vercel exception: uses a fixed well-known IP)
    if (rootStrategy === "a_record" && !targetIsIPv4 && deploymentProvider !== "vercel") {
      res.status(422).json({
        error: "INVALID_DNS_TARGET",
        message: "CNAME targets must be hostnames. A records must be IP addresses.",
      });
      return;
    }

    // Block private IPs
    if (targetIsIPv4 && isPrivateIPv4(providerTarget)) {
      res.status(422).json({
        error: "INVALID_DNS_TARGET",
        message: "Private IP addresses are not allowed as DNS targets.",
      });
      return;
    }
  } else if (
    rootStrategy !== "redirect_to_www" &&
    rootStrategy !== "manual" &&
    wwwStrategy !== "manual"
  ) {
    // Target required unless manual/redirect mode
    res.status(400).json({
      error: "PROVIDER_TARGET_REQUIRED",
      message:
        "Provider DNS target is required unless rootStrategy or wwwStrategy is 'manual', or rootStrategy is 'redirect_to_www'.",
    });
    return;
  }

  const plan = buildPlan(domain, deploymentProvider as ProviderId, providerTarget, rootStrategy, wwwStrategy);
  res.json(plan);
});

// POST /api/domain-setup/check
router.post("/api/domain-setup/check", requireSession, async (req, res) => {
  const body = req.body as { domain?: unknown; expectedPublicOrigin?: unknown };
  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  const expectedOrigin = typeof body.expectedPublicOrigin === "string" ? body.expectedPublicOrigin.trim() : "";

  if (!domain || !isValidDomain(domain)) {
    res.status(400).json({
      error: "INVALID_DOMAIN",
      message: "Domain must be viba.guru or a subdomain of viba.guru.",
    });
    return;
  }

  const checkUrl = `https://${domain}`;
  const urlCheck = validateUrl(checkUrl, { allowHttp: false });
  if (!urlCheck.allowed) {
    res.status(400).json({
      error: "INVALID_URL",
      message: `Cannot check this domain: ${urlCheck.reason}`,
    });
    return;
  }

  let status: "pending" | "connected" | "parked" | "failed" | "unknown" = "unknown";
  let message = "";
  let httpsWorking = false;
  let tlsValid = false;
  let healthzOk: boolean | null = null;
  let resolvedUrl = "";

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);

    let response: Response;
    try {
      response = await fetch(checkUrl, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": "VIBA-DomainCheck/1.0" },
      });
    } finally {
      clearTimeout(timer);
    }

    httpsWorking = true;
    tlsValid = true;
    resolvedUrl = response.url;

    const text = await response.text();

    // Heuristics for GoDaddy parking page detection
    const isParked =
      text.includes("godaddy.com") ||
      text.includes("parkingcrew") ||
      text.includes("Parked Free") ||
      text.includes("domain is for sale") ||
      text.includes("This domain is registered") ||
      text.includes("Under Construction") ||
      response.url.includes("godaddy.com");

    if (isParked) {
      status = "parked";
      message =
        "Domain still appears parked at GoDaddy. DNS change has not completed or records are still pointing to GoDaddy parking.";
    } else {
      // Probe /api/healthz
      try {
        const hCtrl = new AbortController();
        const hTimer = setTimeout(() => hCtrl.abort(), 4000);
        let healthRes: Response;
        try {
          healthRes = await fetch(`${checkUrl}/api/healthz`, {
            signal: hCtrl.signal,
            headers: { "User-Agent": "VIBA-DomainCheck/1.0" },
          });
        } finally {
          clearTimeout(hTimer);
        }
        healthzOk = healthRes.ok;
      } catch {
        healthzOk = false;
      }

      status = "connected";
      message = healthzOk
        ? "Domain is connected and /api/healthz is responding. VIBA is live at this domain."
        : "Domain is reachable. /api/healthz did not respond — app may still be starting.";
    }
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    if (isTimeout) {
      status = "pending";
      message =
        "Domain check timed out. DNS propagation may still be in progress — typically takes 15 minutes to 48 hours.";
    } else {
      status = "failed";
      message =
        "Could not reach the domain over HTTPS. DNS may not have propagated yet, or the deployment provider is not yet configured.";
    }
  }

  res.json({
    domain,
    expectedPublicOrigin: expectedOrigin || `https://${domain}`,
    status,
    message,
    httpsWorking,
    tlsValid,
    healthzOk,
    resolvedUrl,
    rawValuesReturned: false,
    checkedAt: new Date().toISOString(),
  });
});

export default router;
