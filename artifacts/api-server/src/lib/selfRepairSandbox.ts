import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type SandboxStep = {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
};

export type SandboxVerificationResult = {
  ok: boolean;
  repoFullName: string;
  branch: string;
  startedAt: string;
  finishedAt: string;
  steps: SandboxStep[];
  error?: string;
};

const DEFAULT_TIMEOUT_MS = Number(process.env.VIBA_SANDBOX_STEP_TIMEOUT_MS ?? 180_000);
const MAX_OUTPUT_CHARS = Number(process.env.VIBA_SANDBOX_MAX_OUTPUT_CHARS ?? 20_000);

function scrub(value: string, secrets: Array<string | null | undefined>): string {
  let output = value;
  for (const secret of secrets) {
    if (secret && secret.length > 6) output = output.split(secret).join("[REDACTED]");
  }
  return output.slice(-MAX_OUTPUT_CHARS);
}

function run(command: string, args: string[], cwd: string, secrets: Array<string | null | undefined>): Promise<SandboxStep> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: { ...process.env, CI: "true" },
    });

    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(" "),
        exitCode: code,
        timedOut,
        output: scrub(output, secrets),
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ command: [command, ...args].join(" "), exitCode: 1, timedOut, output: scrub(error.message, secrets) });
    });
  });
}

export async function verifyRepoInSandbox(input: {
  repoFullName: string;
  branch: string;
  githubToken?: string | null;
}): Promise<SandboxVerificationResult> {
  const startedAt = new Date().toISOString();
  const sandboxRoot = await mkdtemp(join(tmpdir(), "viba-self-repair-"));
  const repoDir = join(sandboxRoot, "repo");
  const secrets = [input.githubToken];
  const steps: SandboxStep[] = [];

  try {
    const askpassPath = join(sandboxRoot, "askpass.sh");
    if (input.githubToken) {
      await writeFile(askpassPath, `#!/bin/sh\ncase "$1" in\n*Username*) echo x-access-token ;;\n*Password*) echo "${input.githubToken.replace(/"/g, "\\\"")}" ;;\n*) echo "" ;;\nesac\n`, { mode: 0o700 });
    }

    const cloneUrl = `https://github.com/${input.repoFullName}.git`;
    const cloneEnvToken = input.githubToken ? askpassPath : null;
    const cloneStep = await new Promise<SandboxStep>((resolve) => {
      const child = spawn("git", ["clone", "--depth", "1", "--branch", input.branch, cloneUrl, repoDir], {
        cwd: sandboxRoot,
        shell: false,
        env: { ...process.env, GIT_ASKPASS: cloneEnvToken ?? process.env.GIT_ASKPASS ?? "", GIT_TERMINAL_PROMPT: "0" },
      });
      let output = "";
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, DEFAULT_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ command: `git clone --depth 1 --branch ${input.branch} https://github.com/${input.repoFullName}.git`, exitCode: code, timedOut, output: scrub(output, secrets) }); });
      child.on("error", (error) => { clearTimeout(timer); resolve({ command: "git clone", exitCode: 1, timedOut, output: scrub(error.message, secrets) }); });
    });
    steps.push(cloneStep);
    if (cloneStep.exitCode !== 0 || cloneStep.timedOut) throw new Error("Sandbox clone failed.");

    const install = await run("pnpm", ["install", "--frozen-lockfile"], repoDir, secrets);
    steps.push(install);
    if (install.exitCode !== 0 || install.timedOut) throw new Error("Sandbox dependency install failed.");

    const typecheck = await run("pnpm", ["run", "typecheck"], repoDir, secrets);
    steps.push(typecheck);
    if (typecheck.exitCode !== 0 || typecheck.timedOut) throw new Error("Sandbox typecheck failed.");

    const build = await run("pnpm", ["run", "build"], repoDir, secrets);
    steps.push(build);
    if (build.exitCode !== 0 || build.timedOut) throw new Error("Sandbox build failed.");

    return { ok: true, repoFullName: input.repoFullName, branch: input.branch, startedAt, finishedAt: new Date().toISOString(), steps };
  } catch (error) {
    return { ok: false, repoFullName: input.repoFullName, branch: input.branch, startedAt, finishedAt: new Date().toISOString(), steps, error: error instanceof Error ? error.message : "Sandbox verification failed." };
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}
