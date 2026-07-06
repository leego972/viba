import { logger } from "../../lib/logger";
import { maskSecrets } from "./secrets.service";
import type { DockerContainerConfig } from "./deploy.types";

export interface DockerRunResult {
  success: boolean;
  containerId?: string;
  error?: string;
  logs: string[];
}

export interface DockerBuildResult {
  success: boolean;
  imageTag?: string;
  error?: string;
  logs: string[];
}

export function isDockerAvailable(): boolean {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    execSync("docker info --format '{{.ServerVersion}}'", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function buildImage(
  repoDir: string,
  imageTag: string,
  buildArgs: Record<string, string> = {},
  onLog: (line: string) => void = () => {},
): Promise<DockerBuildResult> {
  if (!isDockerAvailable()) {
    const msg = "Docker is not available in this environment. Build skipped.";
    logger.warn(msg);
    onLog(`[SKIP] ${msg}`);
    return { success: false, error: msg, logs: [msg] };
  }

  const { spawn } = require("child_process") as typeof import("child_process");
  const args = ["build", "-t", imageTag];
  for (const [k, v] of Object.entries(buildArgs)) {
    args.push("--build-arg", `${k}=${maskSecrets(v)}`);
  }
  args.push(".");

  return new Promise((resolve) => {
    const logs: string[] = [];
    const proc = spawn("docker", args, { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout?.on("data", (d: Buffer) => {
      const line = maskSecrets(d.toString());
      logs.push(line);
      onLog(line);
    });
    proc.stderr?.on("data", (d: Buffer) => {
      const line = maskSecrets(d.toString());
      logs.push(line);
      onLog(line);
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, imageTag, logs });
      } else {
        resolve({ success: false, error: `docker build exited ${code}`, logs });
      }
    });
    proc.on("error", (err) => {
      resolve({ success: false, error: err.message, logs });
    });
  });
}

export async function stopContainer(containerName: string): Promise<void> {
  if (!isDockerAvailable()) return;
  const { execSync } = require("child_process") as typeof import("child_process");
  try {
    execSync(`docker stop ${containerName} && docker rm ${containerName}`, {
      stdio: "pipe",
      timeout: 30000,
    });
    logger.info({ containerName }, "Container stopped and removed");
  } catch (err) {
    logger.warn({ containerName, err }, "Container stop/remove failed (may not exist)");
  }
}

export async function runContainer(
  config: DockerContainerConfig,
  onLog: (line: string) => void = () => {},
): Promise<DockerRunResult> {
  if (!isDockerAvailable()) {
    const msg = "Docker is not available in this environment. Container start skipped.";
    logger.warn(msg);
    onLog(`[SKIP] ${msg}`);
    return { success: false, error: msg, logs: [msg] };
  }

  const { spawn } = require("child_process") as typeof import("child_process");
  const args = ["run", "-d", "--name", config.name, "--network", config.network];

  for (const [k, v] of Object.entries(config.envVars)) {
    args.push("-e", `${k}=${v}`);
  }
  for (const p of config.ports) {
    args.push("-p", `${p.host}:${p.container}`);
  }
  for (const v of config.volumes) {
    args.push("-v", `${v.host}:${v.container}`);
  }
  args.push("--cpus", config.cpuLimit, "--memory", config.memoryLimit);
  args.push(config.image);

  return new Promise((resolve) => {
    const logs: string[] = [];
    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let containerId = "";
    proc.stdout?.on("data", (d: Buffer) => {
      const line = maskSecrets(d.toString().trim());
      containerId = line;
      logs.push(line);
      onLog(line);
    });
    proc.stderr?.on("data", (d: Buffer) => {
      const line = maskSecrets(d.toString());
      logs.push(line);
      onLog(line);
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ success: true, containerId, logs });
      else resolve({ success: false, error: `docker run exited ${code}`, logs });
    });
    proc.on("error", (err) => resolve({ success: false, error: err.message, logs }));
  });
}

export async function runHealthCheck(
  containerName: string,
  port: number,
  path = "/",
  retries = 5,
  intervalMs = 3000,
): Promise<boolean> {
  if (!isDockerAvailable()) {
    logger.warn("Health check skipped: Docker not available");
    return false;
  }
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}${path}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        logger.info({ containerName, port, path }, "Health check passed");
        return true;
      }
    } catch {
      logger.debug({ containerName, attempt: i + 1 }, "Health check attempt failed, retrying");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function ensureNetwork(networkName: string): Promise<void> {
  if (!isDockerAvailable()) return;
  const { execSync } = require("child_process") as typeof import("child_process");
  try {
    execSync(`docker network inspect ${networkName}`, { stdio: "pipe" });
  } catch {
    execSync(`docker network create ${networkName}`, { stdio: "pipe" });
    logger.info({ networkName }, "Docker network created");
  }
}

export function containerName(projectId: string, suffix: "web" | "postgres" | "redis"): string {
  return `viba-project-${projectId}-${suffix}`;
}

export function imageTag(projectId: string, deploymentId: string): string {
  return `viba-project-${projectId}:${deploymentId}`;
}
