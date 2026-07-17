import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { pool } from "@workspace/db";

function run(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code})\n${output.slice(-12000)}`)));
  });
}

async function claimJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT j.*,a.repository_url,a.branch,a.project_path,a.package_name
      FROM play_publisher_jobs j
      JOIN play_publisher_apps a ON a.id=j.app_id
      WHERE j.kind='build' AND j.status='queued'
      ORDER BY j.created_at
      FOR UPDATE SKIP LOCKED LIMIT 1
    `);
    const job = result.rows[0];
    if (!job) { await client.query("COMMIT"); return null; }
    await client.query("UPDATE play_publisher_jobs SET status='running',started_at=NOW() WHERE id=$1", [job.id]);
    await client.query("COMMIT");
    return job;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function uploadArtifact(filePath: string, jobId: number): Promise<string> {
  const endpoint = process.env.PLAY_ARTIFACT_UPLOAD_URL;
  const token = process.env.PLAY_ARTIFACT_UPLOAD_TOKEN;
  if (!endpoint) throw new Error("PLAY_ARTIFACT_UPLOAD_URL is required");
  const bytes = await readFile(filePath);
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/${jobId}/app-release.aab`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Artifact upload failed (${response.status})`);
  const data = await response.json().catch(() => ({})) as { url?: string };
  if (!data.url) throw new Error("Artifact service did not return a signed download URL");
  return data.url;
}

async function processJob(job: any): Promise<void> {
  const work = await mkdtemp(path.join(tmpdir(), `viba-play-${job.id}-`));
  const logs: string[] = [];
  try {
    logs.push(await run(`git clone --depth 1 --branch ${JSON.stringify(job.branch)} ${JSON.stringify(job.repository_url)} repo`, work, process.env));
    const repo = path.join(work, "repo");
    const project = path.resolve(repo, job.project_path || ".");
    if (!project.startsWith(repo)) throw new Error("Invalid project path");
    const commands: string[] = Array.isArray(job.input?.commands) ? job.input.commands : ["pnpm install --frozen-lockfile", "pnpm run build", "npx cap sync android", "cd android && ./gradlew bundleRelease"];
    for (const command of commands) logs.push(await run(command, project, { ...process.env, CI: "true" }));
    const candidates = [
      path.join(project, "android/app/build/outputs/bundle/release/app-release.aab"),
      path.join(project, "app/build/outputs/bundle/release/app-release.aab"),
    ];
    let artifact: string | undefined;
    for (const candidate of candidates) { try { await readFile(candidate); artifact = candidate; break; } catch {} }
    if (!artifact) throw new Error("Release AAB was not found after build");
    const bytes = await readFile(artifact);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const artifactUrl = await uploadArtifact(artifact, job.id);
    await pool.query(`UPDATE play_publisher_jobs SET status='completed',artifact_url=$1,artifact_sha256=$2,output=$3,completed_at=NOW() WHERE id=$4`, [artifactUrl, sha256, { logs: logs.join("\n").slice(-50000) }, job.id]);
  } catch (error) {
    await pool.query(`UPDATE play_publisher_jobs SET status='failed',error=$1,output=$2,completed_at=NOW() WHERE id=$3`, [error instanceof Error ? error.message : "Build failed", { logs: logs.join("\n").slice(-50000) }, job.id]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function runPlayPublisherWorker(): Promise<void> {
  const pollMs = Math.max(5000, Number(process.env.PLAY_BUILD_POLL_MS ?? 15000));
  for (;;) {
    const job = await claimJob();
    if (job) await processJob(job);
    else await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

if (process.env.PLAY_BUILD_WORKER === "true") {
  runPlayPublisherWorker().catch(error => { console.error("Play Publisher worker stopped", error); process.exit(1); });
}
