#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const sourceRoot = path.resolve(process.argv[2] ?? "../archibald-titan-ai");
const outputRoot = path.resolve(process.argv[3] ?? "audit-results/marketplace");
const seedPath = path.join(sourceRoot, "server/marketplace-seed.ts");
const payloadPath = path.join(sourceRoot, "server/marketplace-payload-generator.ts");

if (!fs.existsSync(seedPath) || !fs.existsSync(payloadPath)) {
  console.error(`Missing Archibald source files under ${sourceRoot}`);
  process.exit(2);
}

fs.mkdirSync(outputRoot, { recursive: true });
const extractRoot = path.join(outputRoot, "extracted");
fs.rmSync(extractRoot, { recursive: true, force: true });
fs.mkdirSync(extractRoot, { recursive: true });

function extractConstants(filePath, names) {
  const text = fs.readFileSync(filePath, "utf8");
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const declarations = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
        declarations.push(printer.printNode(ts.EmitHint.Unspecified, statement, source));
        break;
      }
    }
  }
  const missing = names.filter((name) => !declarations.some((line) => new RegExp(`\\b${name}\\b`).test(line)));
  if (missing.length) throw new Error(`Could not extract ${missing.join(", ")} from ${filePath}`);
  const exportLine = `globalThis.__audit = { ${names.join(", ")} };`;
  const transpiled = ts.transpileModule(`${declarations.join("\n")}\n${exportLine}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  });
  const fatalDiagnostics = (transpiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (fatalDiagnostics.length) {
    throw new Error(fatalDiagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  }
  const sandbox = { console: { log() {}, warn() {}, error() {} }, crypto: globalThis.crypto };
  vm.createContext(sandbox);
  vm.runInContext(transpiled.outputText, sandbox, { timeout: 10_000, filename: filePath });
  return sandbox.__audit;
}

const { MERCHANT_BOTS, MODULE_CATALOG } = extractConstants(seedPath, ["MERCHANT_BOTS", "MODULE_CATALOG"]);
const { LEGAL, PAYLOADS } = extractConstants(payloadPath, ["LEGAL", "PAYLOADS"]);
void LEGAL;

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function tokens(value) {
  return new Set(slug(value).split("-").filter((token) => token.length > 2 && !["the", "and", "for", "module", "agent", "toolkit", "suite", "pro", "titan", "archibald"].includes(token)));
}
function overlapScore(title, key, readme) {
  const a = tokens(title);
  const b = new Set([...tokens(key), ...tokens(readme ?? "")]);
  if (!a.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / a.size;
}

const payloadEntries = Object.entries(PAYLOADS);
const payloadAssignments = new Map();
for (const listing of MODULE_CATALOG) {
  const ranked = payloadEntries
    .map(([key, files]) => ({ key, files, score: overlapScore(listing.title, key, files["README.md"]) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const reliable = Boolean(best && best.score >= 0.45 && (!second || best.score - second.score >= 0.08));
  payloadAssignments.set(listing.title, reliable ? best.key : null);
}

const forbiddenSecretPatterns = [
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
  { name: "OpenAI key", regex: /sk-[A-Za-z0-9]{32,}/g },
  { name: "Private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];
const dangerousPatterns = [
  { name: "reverse shell", regex: /(?:\/dev\/tcp|nc\s+-e|TCPSocket\.new|dup2\(|TCPClient\()/i },
  { name: "credential collection", regex: /credential(?:s)?\s*(?:harvest|extract|dump|steal)/i },
  { name: "ARP or DNS poisoning", regex: /(?:arp[_ -]?poison|dns[_ -]?spoof|ARP\(op=2)/i },
  { name: "destructive command", regex: /(?:rm\s+-rf\s+\/|DROP\s+TABLE|format\s+[A-Z]:)/i },
  { name: "malware persistence", regex: /(?:crontab|schtasks|Run\\|startup folder).*(?:socket|payload|shell)/i },
];

function checkSyntax(moduleDir, fileName, content) {
  const filePath = path.join(moduleDir, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  try {
    if (fileName.endsWith(".json")) JSON.parse(content);
    else if (fileName.endsWith(".py")) execFileSync("python3", ["-m", "py_compile", filePath], { stdio: "pipe", timeout: 20_000 });
    else if (fileName.endsWith(".sh")) execFileSync("bash", ["-n", filePath], { stdio: "pipe", timeout: 20_000 });
    else if (/\.(?:ts|tsx)$/.test(fileName)) {
      const result = ts.transpileModule(content, {
        fileName,
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      });
      const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
      if (errors.length) throw new Error(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; "));
    } else if (fileName.endsWith(".js")) new vm.Script(content, { filename: fileName });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
  }
}

function claimMismatches(listing, files) {
  const claims = `${listing.description ?? ""}\n${listing.longDescription ?? ""}`.toLowerCase();
  const code = Object.entries(files).filter(([name]) => name !== "README.md").map(([, value]) => value).join("\n").toLowerCase();
  const names = Object.keys(files).join(" ").toLowerCase();
  const mismatches = [];
  const requireEvidence = (claimPattern, evidencePattern, label) => {
    if (claimPattern.test(claims) && !evidencePattern.test(`${code}\n${names}`)) mismatches.push(label);
  };
  requireEvidence(/captcha|2captcha|anti-captcha/, /captcha|2captcha|anti-captcha/, "CAPTCHA bypass/detection is advertised but not implemented");
  requireEvidence(/aes-256-gcm/, /aes-256-gcm|createcipheriv\(['\"]aes-256-gcm/, "AES-256-GCM is advertised but not implemented");
  requireEvidence(/pdf report|export_pdf|generates pdf/, /pdfkit|reportlab|weasyprint|puppeteer|\.pdf/, "PDF reporting is advertised but no PDF implementation is present");
  requireEvidence(/hackerone/, /hackerone/, "HackerOne integration is advertised but absent");
  requireEvidence(/bugcrowd/, /bugcrowd/, "Bugcrowd integration is advertised but absent");
  requireEvidence(/intigriti/, /intigriti/, "Intigriti integration is advertised but absent");
  requireEvidence(/docker|sandboxed environment|isolated container/, /dockerfile|docker-compose|container/, "Container sandboxing is advertised but no container definition is present");
  requireEvidence(/github actions|gitlab ci|bitbucket pipelines/, /github|gitlab|bitbucket/, "Repository integration is advertised but absent");
  const providerClaim = claims.match(/(\d+)\+\s*providers/);
  if (providerClaim) {
    const providerCount = (code.match(/loginurl\s*:/g) ?? []).length;
    if (providerCount < Number(providerClaim[1])) mismatches.push(`${providerClaim[1]}+ providers advertised; approximately ${providerCount} provider definitions found`);
  }
  return mismatches;
}

const sellers = MERCHANT_BOTS.map((seller, index) => ({
  index,
  name: seller.name,
  email: seller.email,
  sourceVerifiedFlag: Boolean(seller.verified),
  operationallyVerified: false,
  approved: false,
  verdict: "REJECT_PROFILE_CLAIMS",
  reasons: [
    "Seeded software identity; no independent business or operator verification evidence",
    "Biography contains performance/compliance/adoption claims without supporting evidence",
    "Seller must be relabelled as a Viba-owned automated publisher or removed",
  ],
}));

const payloadReports = new Map();
for (const [key, files] of payloadEntries) {
  const moduleDir = path.join(extractRoot, key);
  const syntaxErrors = [];
  const secrets = [];
  const dangerousCapabilities = [];
  for (const [fileName, rawContent] of Object.entries(files)) {
    const content = String(rawContent);
    const syntaxError = checkSyntax(moduleDir, fileName, content);
    if (syntaxError) syntaxErrors.push({ file: fileName, error: syntaxError });
    for (const pattern of forbiddenSecretPatterns) {
      if (pattern.regex.test(content)) secrets.push({ file: fileName, type: pattern.name });
      pattern.regex.lastIndex = 0;
    }
    for (const pattern of dangerousPatterns) {
      if (pattern.regex.test(content)) dangerousCapabilities.push({ file: fileName, type: pattern.name });
    }
  }
  const hasReadme = typeof files["README.md"] === "string" && files["README.md"].trim().length > 0;
  const hasTests = Object.keys(files).some((name) => /(?:^|\/)(?:test|tests|spec)[^/]*\.(?:py|js|ts|tsx)$/i.test(name));
  payloadReports.set(key, {
    key,
    fileCount: Object.keys(files).length,
    files: Object.keys(files),
    hasReadme,
    hasTests,
    syntaxErrors,
    secrets,
    dangerousCapabilities,
  });
}

const modules = MODULE_CATALOG.map((listing, index) => {
  const payloadKey = payloadAssignments.get(listing.title);
  const payload = payloadKey ? payloadReports.get(payloadKey) : null;
  const seller = sellers[listing.merchantIndex];
  const reasons = [];
  if (!payloadKey || !payload) reasons.push("No reliable one-to-one mapping from listing to payload");
  if (payload && !payload.hasReadme) reasons.push("README missing");
  if (payload && payload.syntaxErrors.length) reasons.push(`${payload.syntaxErrors.length} source syntax/parse failure(s)`);
  if (payload && payload.secrets.length) reasons.push(`${payload.secrets.length} embedded secret(s) detected`);
  if (payload && !payload.hasTests) reasons.push("No executable tests supplied");
  const mismatches = payload ? claimMismatches(listing, PAYLOADS[payloadKey]) : [];
  reasons.push(...mismatches);
  if (payload?.dangerousCapabilities.length) reasons.push("Contains offensive or destructive capability; requires isolated manual security review and cannot be auto-approved");
  const verdict = !payload
    ? "REJECT_NO_PAYLOAD"
    : payload.syntaxErrors.length || payload.secrets.length
      ? "REJECT_BROKEN_OR_UNSAFE"
      : mismatches.length
        ? "REBUILD_OR_REWRITE_LISTING"
        : payload.dangerousCapabilities.length
          ? "QUARANTINE_MANUAL_REVIEW"
          : !payload.hasTests
            ? "REBUILD_TESTS_REQUIRED"
            : "CANDIDATE_REQUIRES_RUNTIME_PROOF";
  return {
    index,
    seller: seller?.name ?? `merchantIndex:${listing.merchantIndex}`,
    title: listing.title,
    category: listing.category,
    riskCategory: listing.riskCategory,
    priceCredits: listing.priceCredits,
    language: listing.language,
    version: listing.version,
    payloadKey,
    approved: false,
    verdict,
    reasons,
    payload,
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  sourceRepository: "leego972/archibald-titan-ai",
  sellers: sellers.length,
  listings: modules.length,
  payloads: payloadEntries.length,
  approvedSellers: 0,
  approvedListings: 0,
  verdictCounts: Object.fromEntries([...new Set(modules.map((m) => m.verdict))].sort().map((verdict) => [verdict, modules.filter((m) => m.verdict === verdict).length])),
};

const report = { summary, sellers, modules, unassignedPayloads: payloadEntries.map(([key]) => key).filter((key) => !modules.some((m) => m.payloadKey === key)) };
fs.writeFileSync(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));

const markdown = [
  "# Viba Marketplace Legacy Catalogue Audit",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  "## Decision",
  "",
  "**Zero legacy sellers and zero legacy listings are approved for sale.** Every item remains quarantined until its verdict is resolved and runtime evidence is attached.",
  "",
  "## Summary",
  "",
  `- Sellers inspected: ${summary.sellers}`,
  `- Listings inspected: ${summary.listings}`,
  `- Payload definitions inspected: ${summary.payloads}`,
  `- Approved sellers: ${summary.approvedSellers}`,
  `- Approved listings: ${summary.approvedListings}`,
  "",
  "## Seller verdicts",
  "",
  "| Seller | Verdict | Reason |",
  "|---|---|---|",
  ...sellers.map((s) => `| ${s.name} | ${s.verdict} | ${s.reasons[0]} |`),
  "",
  "## Module verdicts",
  "",
  "| Listing | Seller | Payload | Verdict | Primary reason |",
  "|---|---|---|---|---|",
  ...modules.map((m) => `| ${m.title.replace(/\|/g, "\\|")} | ${m.seller} | ${m.payloadKey ?? "unmapped"} | ${m.verdict} | ${(m.reasons[0] ?? "Runtime proof still required").replace(/\|/g, "\\|")} |`),
  "",
  "## Gate",
  "",
  "A listing may only become active after: exact payload mapping, clean syntax/build, dependency and secret scans, tests, isolated runtime execution, claim-by-claim evidence, and explicit administrator approval.",
  "",
].join("\n");
fs.writeFileSync(path.join(outputRoot, "REPORT.md"), markdown);
console.log(JSON.stringify(summary, null, 2));
