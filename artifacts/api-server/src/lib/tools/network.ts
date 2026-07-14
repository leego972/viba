/**
 * VIBA Network / Recon Tools
 *
 * dns_lookup        — query DNS records (A, AAAA, MX, TXT, CNAME, NS)
 * whois_lookup      — WHOIS/RDAP domain registration info
 * port_check        — check if common ports are open on a host (TCP connect)
 * cve_search        — search NVD CVE database for known vulnerabilities
 * dependency_audit  — audit npm package(s) for known CVEs via OSV.dev (free, no key)
 */

import dns from "node:dns/promises";
import net from "node:net";

export interface NetworkTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

const COMMON_PORTS: Array<{ port: number; service: string }> = [
  { port: 21,   service: "FTP" },
  { port: 22,   service: "SSH" },
  { port: 23,   service: "Telnet" },
  { port: 25,   service: "SMTP" },
  { port: 53,   service: "DNS" },
  { port: 80,   service: "HTTP" },
  { port: 110,  service: "POP3" },
  { port: 143,  service: "IMAP" },
  { port: 443,  service: "HTTPS" },
  { port: 465,  service: "SMTPS" },
  { port: 587,  service: "SMTP Submission" },
  { port: 993,  service: "IMAPS" },
  { port: 995,  service: "POP3S" },
  { port: 1433, service: "MSSQL" },
  { port: 3000, service: "Dev server" },
  { port: 3306, service: "MySQL" },
  { port: 5432, service: "PostgreSQL" },
  { port: 6379, service: "Redis" },
  { port: 8080, service: "HTTP-alt" },
  { port: 8443, service: "HTTPS-alt" },
  { port: 27017, service: "MongoDB" },
];

function checkPort(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

export function getNetworkTools(): NetworkTool[] {
  return [

    // ── dns_lookup ───────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "dns_lookup",
          description: "Query DNS records for any domain. Supports A, AAAA, MX, TXT, CNAME, NS, SOA, and SRV record types. Useful for verifying domain configuration, email setup (MX/SPF/DKIM), domain ownership, or diagnosing connectivity issues.",
          parameters: {
            type: "object",
            properties: {
              hostname: { type: "string", description: "Domain to query (e.g. viba.guru)" },
              record_types: {
                type: "array",
                items: { type: "string", enum: ["A", "AAAA", "MX", "TXT", "CNAME", "NS", "SOA"] },
                description: "Record types to look up. Default: all common types.",
              },
            },
            required: ["hostname"],
          },
        },
      },
      async execute(args) {
        const hostname = str(args["hostname"]).replace(/^https?:\/\//, "").split("/")[0] ?? "";
        if (!hostname) return "Error: hostname is required";
        const types = Array.isArray(args["record_types"]) && args["record_types"].length > 0
          ? (args["record_types"] as string[])
          : ["A", "AAAA", "MX", "TXT", "CNAME", "NS"];

        const results: string[] = [`DNS Records: ${hostname}`, ""];

        for (const type of types) {
          try {
            let records: unknown;
            switch (type) {
              case "A":     records = await dns.resolve4(hostname); break;
              case "AAAA":  records = await dns.resolve6(hostname); break;
              case "MX":    records = await dns.resolveMx(hostname); break;
              case "TXT":   records = await dns.resolveTxt(hostname); break;
              case "CNAME": records = await dns.resolveCname(hostname); break;
              case "NS":    records = await dns.resolveNs(hostname); break;
              case "SOA":   records = await dns.resolveSoa(hostname); break;
              default:      records = null;
            }
            if (Array.isArray(records)) {
              results.push(`${type}:`);
              for (const r of records) {
                if (typeof r === "string") results.push(`  ${r}`);
                else if (typeof r === "object" && r !== null) results.push(`  ${JSON.stringify(r)}`);
              }
            } else if (records) {
              results.push(`${type}: ${JSON.stringify(records)}`);
            }
          } catch {
            results.push(`${type}: (no records)`);
          }
        }

        return results.join("\n");
      },
    },

    // ── whois_lookup ─────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "whois_lookup",
          description: "Look up domain registration information via RDAP (Registration Data Access Protocol). Returns registrar, registration date, expiry date, nameservers, and status flags for any domain.",
          parameters: {
            type: "object",
            properties: {
              domain: { type: "string", description: "Domain to look up (e.g. viba.guru — no https://)" },
            },
            required: ["domain"],
          },
        },
      },
      async execute(args) {
        const domain = str(args["domain"]).replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase() ?? "";
        if (!domain) return "Error: domain is required";
        try {
          const res = await fetch(`https://rdap.org/domain/${domain}`, {
            headers: { "Accept": "application/json", "User-Agent": "VIBA-Agent/1.0" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return `RDAP lookup failed: HTTP ${res.status}`;
          const data = await res.json() as {
            ldhName?: string;
            status?: string[];
            events?: Array<{ eventAction: string; eventDate: string }>;
            entities?: Array<{ roles?: string[]; vcardArray?: unknown }>;
            nameservers?: Array<{ ldhName?: string }>;
            secureDNS?: { delegationSigned?: boolean };
          };

          const events: Record<string, string> = {};
          for (const e of data.events ?? []) {
            events[e.eventAction] = new Date(e.eventDate).toLocaleDateString();
          }

          const registrar = data.entities?.find(e => e.roles?.includes("registrar"));
          const nameservers = (data.nameservers ?? []).map(n => n.ldhName ?? "unknown");

          return [
            `WHOIS: ${domain}`,
            `Domain:      ${data.ldhName ?? domain}`,
            `Status:      ${(data.status ?? []).join(", ") || "unknown"}`,
            `Registered:  ${events["registration"] ?? "unknown"}`,
            `Last Updated:${events["last changed"] ?? "unknown"}`,
            `Expires:     ${events["expiration"] ?? "unknown"}`,
            `Registrar:   ${registrar ? JSON.stringify(registrar.vcardArray).slice(0, 80) : "unknown"}`,
            `Nameservers: ${nameservers.join(", ") || "none"}`,
            `DNSSEC:      ${data.secureDNS?.delegationSigned ? "signed" : "not signed"}`,
          ].join("\n");
        } catch (err) {
          return `WHOIS failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ── port_check ───────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "port_check",
          description: "Check which network ports are open on a host using TCP connect probes. Scans common ports (SSH, HTTP, HTTPS, databases, dev servers) or a custom list. Useful for firewall audits, identifying exposed services, and security hardening.",
          parameters: {
            type: "object",
            properties: {
              host: { type: "string", description: "Hostname or IP to scan" },
              ports: {
                type: "array",
                items: { type: "number" },
                description: "Specific ports to check. If omitted, scans the 21 most common ports.",
              },
            },
            required: ["host"],
          },
        },
      },
      async execute(args) {
        const host = str(args["host"]).replace(/^https?:\/\//, "").split("/")[0] ?? "";
        if (!host) return "Error: host is required";

        const portsToCheck = Array.isArray(args["ports"]) && args["ports"].length > 0
          ? (args["ports"] as number[]).slice(0, 50).map(p => {
              const known = COMMON_PORTS.find(c => c.port === p);
              return { port: p, service: known?.service ?? "unknown" };
            })
          : COMMON_PORTS;

        const open: string[] = [];
        const closed: string[] = [];

        await Promise.all(
          portsToCheck.map(async ({ port, service }) => {
            const isOpen = await checkPort(host, port);
            if (isOpen) open.push(`  ✅ ${port}/${service}`);
            else closed.push(`  ❌ ${port}/${service}`);
          })
        );

        const openSorted = open.sort();
        const closedSorted = closed.sort();

        return [
          `Port Scan: ${host} (${portsToCheck.length} ports checked)`,
          "",
          `OPEN (${openSorted.length}):`,
          openSorted.length ? openSorted.join("\n") : "  (none)",
          "",
          `CLOSED/FILTERED (${closedSorted.length}):`,
          closedSorted.join("\n"),
        ].join("\n");
      },
    },

    // ── cve_search ───────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "cve_search",
          description: "Search the NVD (National Vulnerability Database) for CVEs by keyword, product name, or CVE ID. Returns severity scores (CVSS), descriptions, and affected versions. Use for security research, dependency risk assessment, and vulnerability management.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "CVE ID (e.g. CVE-2021-44228) or keyword/product name (e.g. 'log4j', 'openssl', 'express')" },
              max_results: { type: "number", description: "Maximum results to return (default: 5, max: 20)" },
            },
            required: ["query"],
          },
        },
      },
      async execute(args) {
        const query = str(args["query"]).trim();
        if (!query) return "Error: query is required";
        const limit = Math.min(typeof args["max_results"] === "number" ? args["max_results"] : 5, 20);

        try {
          const isCveId = /^CVE-\d{4}-\d+$/i.test(query);
          const url = isCveId
            ? `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${query.toUpperCase()}`
            : `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=${limit}`;

          const res = await fetch(url, {
            headers: { "User-Agent": "VIBA-Agent/1.0" },
            signal: AbortSignal.timeout(15_000),
          });

          if (!res.ok) return `NVD API returned ${res.status}`;

          const data = await res.json() as {
            totalResults: number;
            vulnerabilities: Array<{
              cve: {
                id: string;
                descriptions: Array<{ lang: string; value: string }>;
                metrics?: {
                  cvssMetricV31?: Array<{ cvssData: { baseScore: number; baseSeverity: string } }>;
                  cvssMetricV2?: Array<{ cvssData: { baseScore: number }; baseSeverity?: string }>;
                };
                published: string;
                lastModified: string;
              };
            }>;
          };

          if (!data.vulnerabilities?.length) return `No CVEs found for "${query}".`;

          const lines = [`CVE Search: "${query}" — ${data.totalResults} total results (showing ${Math.min(limit, data.vulnerabilities.length)})`, ""];
          for (const { cve } of data.vulnerabilities.slice(0, limit)) {
            const desc = cve.descriptions.find(d => d.lang === "en")?.value ?? "No description";
            const v31 = cve.metrics?.cvssMetricV31?.[0]?.cvssData;
            const v2  = cve.metrics?.cvssMetricV2?.[0];
            const score = v31 ? `CVSS v3.1: ${v31.baseScore} (${v31.baseSeverity})` :
                          v2  ? `CVSS v2: ${v2.cvssData.baseScore} (${v2.baseSeverity ?? ""})` : "No score";
            lines.push(`${cve.id}`);
            lines.push(`  Score:     ${score}`);
            lines.push(`  Published: ${new Date(cve.published).toLocaleDateString()}`);
            lines.push(`  ${desc.slice(0, 200)}${desc.length > 200 ? "…" : ""}`);
            lines.push("");
          }
          return lines.join("\n");
        } catch (err) {
          return `CVE search failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ── dependency_audit ─────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "dependency_audit",
          description: "Check one or more npm packages for known security vulnerabilities using the OSV.dev database (free, no API key needed). Returns CVE IDs, severity, and affected version ranges for each package.",
          parameters: {
            type: "object",
            properties: {
              packages: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "npm package name (e.g. 'express')" },
                    version: { type: "string", description: "Version to check (e.g. '4.17.1'). If omitted, checks all known vulnerabilities." },
                  },
                  required: ["name"],
                },
                description: "List of packages to audit",
              },
            },
            required: ["packages"],
          },
        },
      },
      async execute(args) {
        if (!Array.isArray(args["packages"]) || args["packages"].length === 0) return "Error: packages array is required";
        const pkgs = (args["packages"] as Array<{ name: string; version?: string }>).slice(0, 20);

        const results: string[] = [`Dependency Audit (OSV.dev) — ${pkgs.length} package(s)`, ""];

        for (const pkg of pkgs) {
          if (!pkg.name) continue;
          try {
            const body = pkg.version
              ? { version: pkg.version, package: { name: pkg.name, ecosystem: "npm" } }
              : { package: { name: pkg.name, ecosystem: "npm" } };

            const res = await fetch("https://api.osv.dev/v1/query", {
              method: "POST",
              headers: { "Content-Type": "application/json", "User-Agent": "VIBA-Agent/1.0" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(10_000),
            });

            if (!res.ok) { results.push(`${pkg.name}@${pkg.version ?? "any"}: API error ${res.status}`); continue; }

            const data = await res.json() as { vulns?: Array<{ id: string; summary?: string; severity?: Array<{ type: string; score: string }>; database_specific?: { severity?: string } }> };

            if (!data.vulns?.length) {
              results.push(`✅ ${pkg.name}${pkg.version ? `@${pkg.version}` : ""}: No known vulnerabilities`);
            } else {
              results.push(`🚨 ${pkg.name}${pkg.version ? `@${pkg.version}` : ""}: ${data.vulns.length} vulnerability/ies`);
              for (const v of data.vulns.slice(0, 5)) {
                const severity = v.database_specific?.severity ?? v.severity?.[0]?.score ?? "unknown";
                results.push(`  ${v.id} [${severity}]: ${(v.summary ?? "No description").slice(0, 120)}`);
              }
              if (data.vulns.length > 5) results.push(`  ... and ${data.vulns.length - 5} more`);
            }
          } catch (err) {
            results.push(`${pkg.name}: check failed — ${err instanceof Error ? err.message : String(err)}`);
          }
          results.push("");
        }
        return results.join("\n");
      },
    },

  ];
}
