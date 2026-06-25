import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import domainSetupRouter from "./domainSetup";
import {
  isValidDomain,
  isValidIPv4,
  isPrivateIPv4,
  isHostname,
  hasEmbeddedCredentials,
} from "./domainSetup";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    (_req as unknown as { session: { userId: string } }).session = { userId: "test-user-1" };
    next();
  });
  app.use(domainSetupRouter);
  return app;
}

let app: ReturnType<typeof buildApp>;
beforeAll(() => {
  app = buildApp();
});

// ─── Helper to build a valid plan body ────────────────────────────────────────

const BASE_PLAN = {
  domain: "viba.guru",
  dnsProvider: "godaddy",
  deploymentProvider: "railway",
  providerTarget: "",
  rootStrategy: "redirect_to_www",
  wwwStrategy: "cname",
};

// ─── GET /api/domain-setup/providers ─────────────────────────────────────────

describe("GET /api/domain-setup/providers", () => {
  it("returns 200 with providers list", async () => {
    const res = await request(app).get("/api/domain-setup/providers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.providers)).toBe(true);
    expect(res.body.providers.length).toBeGreaterThanOrEqual(6);
  });

  it("includes all expected providers", async () => {
    const res = await request(app).get("/api/domain-setup/providers");
    const ids = res.body.providers.map((p: { id: string }) => p.id);
    expect(ids).toContain("railway");
    expect(ids).toContain("render");
    expect(ids).toContain("digitalocean");
    expect(ids).toContain("vercel");
    expect(ids).toContain("sevall");
    expect(ids).toContain("custom");
  });

  it("each provider has wizardCopy and exampleTarget", async () => {
    const res = await request(app).get("/api/domain-setup/providers");
    for (const p of res.body.providers) {
      expect(p.wizardCopy).toBeTruthy();
      expect(p.exampleTarget).toBeTruthy();
    }
  });

  it("never returns rawValuesReturned: true", async () => {
    const res = await request(app).get("/api/domain-setup/providers");
    expect(res.body.rawValuesReturned).toBe(false);
  });
});

// ─── POST /api/domain-setup/plan ─────────────────────────────────────────────

describe("Domain Setup Plan — Railway", () => {
  it("creates GoDaddy plan for Railway with CNAME www + redirect root", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "railway",
      providerTarget: "my-app.up.railway.app",
      rootStrategy: "redirect_to_www",
      wwwStrategy: "cname",
    });
    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("viba.guru");
    expect(res.body.deploymentProvider).toBe("railway");
    expect(res.body.dnsProvider).toBe("godaddy");
    expect(res.body.recordsToAdd.length).toBeGreaterThan(0);
    const wwwRecord = res.body.recordsToAdd.find((r: { name: string }) => r.name === "www");
    expect(wwwRecord?.type).toBe("CNAME");
    expect(wwwRecord?.value).toBe("my-app.up.railway.app");
    expect(res.body.rawValuesReturned).toBe(false);
  });

  it("Railway plan includes manual steps", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      ...BASE_PLAN,
      deploymentProvider: "railway",
      providerTarget: "my-app.up.railway.app",
    });
    expect(res.body.manualSteps.length).toBeGreaterThanOrEqual(5);
    expect(res.body.manualSteps.some((s: string) => s.includes("GoDaddy"))).toBe(true);
    expect(res.body.manualSteps.some((s: string) => s.includes("Railway"))).toBe(true);
  });

  it("Railway plan includes recordsToRemove (GoDaddy parking)", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      ...BASE_PLAN,
      deploymentProvider: "railway",
      providerTarget: "my-app.up.railway.app",
    });
    expect(res.body.recordsToRemove.length).toBeGreaterThan(0);
  });
});

describe("Domain Setup Plan — Render", () => {
  it("creates GoDaddy plan for Render", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "render",
      providerTarget: "my-service.onrender.com",
      rootStrategy: "redirect_to_www",
      wwwStrategy: "cname",
    });
    expect(res.status).toBe(200);
    expect(res.body.deploymentProvider).toBe("render");
    expect(res.body.recordsToAdd.some((r: { type: string; name: string }) => r.type === "CNAME" && r.name === "www")).toBe(true);
    expect(res.body.rawValuesReturned).toBe(false);
  });
});

describe("Domain Setup Plan — DigitalOcean", () => {
  it("creates GoDaddy plan for DigitalOcean", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "digitalocean",
      providerTarget: "my-app.ondigitalocean.app",
      rootStrategy: "redirect_to_www",
      wwwStrategy: "cname",
    });
    expect(res.status).toBe(200);
    expect(res.body.deploymentProvider).toBe("digitalocean");
    expect(res.body.rawValuesReturned).toBe(false);
  });
});

describe("Domain Setup Plan — Vercel", () => {
  it("creates GoDaddy plan for Vercel with A record for root", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "vercel",
      providerTarget: "cname.vercel-dns.com",
      rootStrategy: "a_record",
      wwwStrategy: "cname",
    });
    expect(res.status).toBe(200);
    expect(res.body.deploymentProvider).toBe("vercel");
    const aRecord = res.body.recordsToAdd.find((r: { name: string; type: string }) => r.name === "@" && r.type === "A");
    expect(aRecord).toBeTruthy();
    expect(aRecord.value).toBe("76.76.21.21");
    const cnameRecord = res.body.recordsToAdd.find((r: { name: string; type: string }) => r.name === "www" && r.type === "CNAME");
    expect(cnameRecord).toBeTruthy();
    expect(res.body.rawValuesReturned).toBe(false);
  });
});

describe("Domain Setup Plan — Sevall (manual-guided)", () => {
  it("creates manual-guided plan for Sevall", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "sevall",
      providerTarget: "",
      rootStrategy: "manual",
      wwwStrategy: "manual",
    });
    expect(res.status).toBe(200);
    expect(res.body.deploymentProvider).toBe("sevall");
    expect(res.body.manualSteps.length).toBeGreaterThan(0);
    expect(res.body.rawValuesReturned).toBe(false);
  });
});

describe("Domain Setup Plan — Custom provider", () => {
  it("creates custom provider plan with A record IP", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "custom",
      providerTarget: "203.0.113.1",
      rootStrategy: "a_record",
      wwwStrategy: "manual",
    });
    expect(res.status).toBe(200);
    expect(res.body.deploymentProvider).toBe("custom");
    const aRecord = res.body.recordsToAdd.find((r: { name: string }) => r.name === "@");
    expect(aRecord?.value).toBe("203.0.113.1");
    expect(res.body.rawValuesReturned).toBe(false);
  });
});

// ─── Validation Rules ─────────────────────────────────────────────────────────

describe("Domain Setup Plan — validation", () => {
  it("rejects invalid domain", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      ...BASE_PLAN,
      domain: "evil.com",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_DOMAIN");
  });

  it("accepts viba.guru subdomains", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      ...BASE_PLAN,
      domain: "staging.viba.guru",
      providerTarget: "staging.up.railway.app",
    });
    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("staging.viba.guru");
  });

  it("rejects invalid deployment provider", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      ...BASE_PLAN,
      deploymentProvider: "not_a_provider",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_PROVIDER");
  });

  it("CNAME target rejects IP address", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "railway",
      providerTarget: "1.2.3.4",
      rootStrategy: "redirect_to_www",
      wwwStrategy: "cname",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("INVALID_DNS_TARGET");
    expect(res.body.message).toContain("hostnames");
  });

  it("A record rejects hostname", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "custom",
      providerTarget: "my-app.provider.com",
      rootStrategy: "a_record",
      wwwStrategy: "manual",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("INVALID_DNS_TARGET");
    expect(res.body.message).toContain("IP addresses");
  });

  it("private IP rejected", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "custom",
      providerTarget: "192.168.1.1",
      rootStrategy: "a_record",
      wwwStrategy: "manual",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("INVALID_DNS_TARGET");
    expect(res.body.message).toContain("Private");
  });

  it("localhost rejected in CNAME position", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "railway",
      providerTarget: "localhost",
      rootStrategy: "redirect_to_www",
      wwwStrategy: "cname",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("INVALID_DNS_TARGET");
    expect(res.body.message).toContain("localhost");
  });

  it("file:// URL rejected", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "railway",
      providerTarget: "file:///etc/passwd",
      rootStrategy: "redirect_to_www",
      wwwStrategy: "cname",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("INVALID_DNS_TARGET");
    expect(res.body.message).toContain("file://");
  });

  it("embedded credentials rejected", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "viba.guru",
      dnsProvider: "godaddy",
      deploymentProvider: "railway",
      providerTarget: "user:pass@my-app.railway.app",
      rootStrategy: "redirect_to_www",
      wwwStrategy: "cname",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("INVALID_DNS_TARGET");
  });

  it("rawValuesReturned is always false in plan response", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      ...BASE_PLAN,
      providerTarget: "my-app.up.railway.app",
    });
    expect(res.body.rawValuesReturned).toBe(false);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('"rawValuesReturned":true');
  });
});

// ─── POST /api/domain-setup/check ────────────────────────────────────────────

describe("Domain Setup Check", () => {
  it("returns 400 for invalid domain", async () => {
    const res = await request(app).post("/api/domain-setup/check").send({
      domain: "evil.com",
      expectedPublicOrigin: "https://evil.com",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_DOMAIN");
  });

  it("returns check result shape for valid domain", async () => {
    const res = await request(app).post("/api/domain-setup/check").send({
      domain: "viba.guru",
      expectedPublicOrigin: "https://viba.guru",
    });
    // Status will vary (parked/connected/failed/pending depending on real DNS)
    // but response shape must always be correct
    expect(res.status).toBe(200);
    expect(["pending", "connected", "parked", "failed", "unknown"]).toContain(res.body.status);
    expect(res.body.domain).toBe("viba.guru");
    expect(res.body.rawValuesReturned).toBe(false);
    expect(typeof res.body.httpsWorking).toBe("boolean");
    expect(res.body.checkedAt).toBeTruthy();
  }, 12000); // 12s timeout to allow real fetch attempt

  it("DNS propagation pending does not throw — returns defined status", async () => {
    const res = await request(app).post("/api/domain-setup/check").send({
      domain: "viba.guru",
      expectedPublicOrigin: "https://viba.guru",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.message).toBeTruthy();
  }, 12000);

  it("rawValuesReturned is always false in check response", async () => {
    const res = await request(app).post("/api/domain-setup/check").send({
      domain: "viba.guru",
      expectedPublicOrigin: "https://viba.guru",
    });
    expect(res.body.rawValuesReturned).toBe(false);
  }, 12000);
});

// ─── Validation helper unit tests ────────────────────────────────────────────

describe("isValidDomain", () => {
  it("accepts viba.guru", () => expect(isValidDomain("viba.guru")).toBe(true));
  it("accepts staging.viba.guru", () => expect(isValidDomain("staging.viba.guru")).toBe(true));
  it("rejects evil.com", () => expect(isValidDomain("evil.com")).toBe(false));
  it("rejects viba.guru.evil.com", () => expect(isValidDomain("viba.guru.evil.com")).toBe(false));
});

describe("isValidIPv4", () => {
  it("accepts 76.76.21.21", () => expect(isValidIPv4("76.76.21.21")).toBe(true));
  it("accepts 203.0.113.1", () => expect(isValidIPv4("203.0.113.1")).toBe(true));
  it("rejects hostname", () => expect(isValidIPv4("my-app.railway.app")).toBe(false));
  it("rejects partial IP", () => expect(isValidIPv4("1.2.3")).toBe(false));
});

describe("isPrivateIPv4", () => {
  it("flags 192.168.1.1", () => expect(isPrivateIPv4("192.168.1.1")).toBe(true));
  it("flags 10.0.0.1", () => expect(isPrivateIPv4("10.0.0.1")).toBe(true));
  it("flags 172.16.0.1", () => expect(isPrivateIPv4("172.16.0.1")).toBe(true));
  it("flags 127.0.0.1", () => expect(isPrivateIPv4("127.0.0.1")).toBe(true));
  it("flags 169.254.169.254", () => expect(isPrivateIPv4("169.254.169.254")).toBe(true));
  it("allows 76.76.21.21", () => expect(isPrivateIPv4("76.76.21.21")).toBe(false));
  it("allows 203.0.113.1", () => expect(isPrivateIPv4("203.0.113.1")).toBe(false));
});

describe("isHostname", () => {
  it("accepts my-app.railway.app", () => expect(isHostname("my-app.railway.app")).toBe(true));
  it("accepts cname.vercel-dns.com", () => expect(isHostname("cname.vercel-dns.com")).toBe(true));
  it("accepts FQDN with trailing dot", () => expect(isHostname("my-app.railway.app.")).toBe(true));
});

describe("hasEmbeddedCredentials", () => {
  it("detects user:pass@host", () => expect(hasEmbeddedCredentials("user:pass@host.com")).toBe(true));
  it("ignores plain hostname", () => expect(hasEmbeddedCredentials("my-app.railway.app")).toBe(false));
  it("ignores host with port", () => expect(hasEmbeddedCredentials("my-app.railway.app:443")).toBe(false));
});

// ─── Route Registry ───────────────────────────────────────────────────────────

describe("Route registry — domainSetup routes mounted", () => {
  it("GET /api/domain-setup/providers is accessible", async () => {
    const res = await request(app).get("/api/domain-setup/providers");
    expect(res.status).not.toBe(404);
  });

  it("POST /api/domain-setup/plan is accessible", async () => {
    const res = await request(app).post("/api/domain-setup/plan").send({
      domain: "invalid", deploymentProvider: "railway",
    });
    expect(res.status).not.toBe(404);
  });

  it("POST /api/domain-setup/check is accessible", async () => {
    const res = await request(app).post("/api/domain-setup/check").send({
      domain: "invalid",
    });
    expect(res.status).not.toBe(404);
  });

  it("existing routes are not affected", async () => {
    // domainSetup router should not swallow unrelated routes
    const res = await request(app).get("/api/security/status");
    expect(res.status).toBe(404); // not mounted here — expected 404 in isolated app
  });
});
