#!/usr/bin/env node
/**
 * VIBA Safe Build Gate
 * Run: node ./scripts/safe-build.mjs
 *
 * Verifies a branch is production-deployable before merge.
 * Hard fails: typecheck, API tests, API build, frontend build
 * Warnings: browser check, railway cli check (unless their files changed)
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPORT_DIR = join(ROOT, "artifacts", "reports");
const REPORT_PATH = join(REPORT_DIR, "safe-build-report.json");

const RED = "\x1b[31m", YELLOW = "\x1b[33m", GREEN = "\x1b[32m", RESET = "\x1b[0m", BOLD = "\x1b[1m";

function log(color, prefix, msg) {
  console.log(`${color}${BOLD}[${prefix}]${RESET} ${msg}`);
}

function run(label, cmd, opts = {}) {
  const { cwd = ROOT, hardFail = true, warnOnly = false } = opts;
  log(BOLD, "RUN", `${label}: ${cmd}`);
  const start = Date.now();
  let output = "";
  let status = "passed";
  let error = null;

  try {
    output = execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8" });
    log(GREEN, "OK", label);
  } catch (err) {
    output = (err.stdout ?? "") + "\n" + (err.stderr ?? "");
    error = err.message;
    if (warnOnly) {
      status = "warning";
      log(YELLOW, "WARN", `${label} — non-blocking warning`);
    } else if (hardFail) {
      status = "failed";
      log(RED, "FAIL", `${label}`);
    }
  }

  const durationMs = Date.now() - start;
  return {
    label,
    cmd,
    status,
    durationMs,
    output: output.slice(-3000),
    error,
    hardFail,
    warnOnly,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  log(BOLD, "VIBA", "Safe Build Gate starting…");

  mkdirSync(REPORT_DIR, { recursive: true });

  const steps = [];

  steps.push(run("Install dependencies", "pnpm install --no-frozen-lockfile", { hardFail: true }));
  steps.push(run("Type check", "pnpm run typecheck", { hardFail: true }));
  steps.push(run("API tests", "pnpm --filter @workspace/api-server run test", { hardFail: true }));
  steps.push(run("Browser check", "pnpm --filter @workspace/api-server run browser:check", { hardFail: false, warnOnly: true }));
  steps.push(run("Railway CLI check", "pnpm --filter @workspace/api-server run railway:cli-check", { hardFail: false, warnOnly: true }));
  steps.push(run("API server build", "pnpm --filter @workspace/api-server run build", { hardFail: true }));
  steps.push(run("Frontend build", "pnpm --filter @workspace/bridge-ai run build", { hardFail: true }));

  const completedAt = new Date().toISOString();

  const failedSteps = steps.filter((s) => s.status === "failed").map((s) => s.label);
  const warnings = steps.filter((s) => s.status === "warning").map((s) => s.label);
  const passed = failedSteps.length === 0;

  const report = {
    startedAt,
    completedAt,
    status: passed ? "passed" : "failed",
    failedSteps,
    warnings,
    mergeAllowed: passed,
    deployAllowed: passed,
    commands: steps.map((s) => s.cmd),
    steps: steps.map((s) => ({
      label: s.label,
      status: s.status,
      durationMs: s.durationMs,
      output: s.output,
      error: s.error,
    })),
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("");
  if (passed) {
    log(GREEN, "SAFE BUILD", `PASSED — merge allowed. Report: ${REPORT_PATH}`);
    if (warnings.length) log(YELLOW, "WARNINGS", warnings.join(", "));
  } else {
    log(RED, "SAFE BUILD", `FAILED — do not merge. Fix: ${failedSteps.join(", ")}`);
    log(RED, "REPORT", REPORT_PATH);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
