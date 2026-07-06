import { logger } from "../../lib/logger";
import type { CaddyRoute } from "./deploy.types";

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL ?? "http://localhost:2019";
const BASE_DOMAIN = process.env.VIBA_DEPLOY_BASE_DOMAIN ?? "viba.local";

export function generateCaddyfile(routes: CaddyRoute[]): string {
  const blocks = routes.map((r) => {
    const hosts = [
      `${r.projectSlug}.${BASE_DOMAIN}`,
      ...(r.customDomain ? [r.customDomain] : []),
    ];
    return `${hosts.join(", ")} {
  reverse_proxy localhost:${r.upstreamPort}
  encode gzip
  header {
    X-Powered-By "VIBA Deploy"
  }
}`;
  });
  return blocks.join("\n\n");
}

export function generateDnsVerificationInstructions(domain: string, token: string): string {
  return `To verify ownership of ${domain}, add this DNS record:

Type:  TXT
Name:  _viba-deploy.${domain}
Value: viba-verify-${token}

After adding the record, click "Verify Domain" in your VIBA Deploy dashboard.
DNS changes may take up to 48 hours to propagate.`;
}

export async function upsertCaddyRoute(route: CaddyRoute): Promise<boolean> {
  if (!process.env.CADDY_ADMIN_URL) {
    logger.warn("CADDY_ADMIN_URL not set — Caddy routing skipped (dev mode)");
    return false;
  }

  const id = `viba-${route.projectSlug}`;
  const hosts = [
    `${route.projectSlug}.${BASE_DOMAIN}`,
    ...(route.customDomain ? [route.customDomain] : []),
  ];

  const config = {
    "@id": id,
    match: [{ host: hosts }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `localhost:${route.upstreamPort}` }],
      },
    ],
  };

  try {
    const res = await fetch(
      `${CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes/${id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.ok) {
      logger.info({ id, hosts }, "Caddy route upserted");
      return true;
    }
    logger.warn({ status: res.status }, "Caddy upsert failed");
    return false;
  } catch (err) {
    logger.warn({ err }, "Caddy admin API unreachable — routing not updated");
    return false;
  }
}

export async function removeCaddyRoute(projectSlug: string): Promise<void> {
  if (!process.env.CADDY_ADMIN_URL) return;
  const id = `viba-${projectSlug}`;
  try {
    await fetch(`${CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes/${id}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    logger.info({ id }, "Caddy route removed");
  } catch (err) {
    logger.warn({ err }, "Caddy remove failed");
  }
}
