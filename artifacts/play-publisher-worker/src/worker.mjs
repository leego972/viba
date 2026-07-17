import { Client } from "pg";
import { createDecipheriv, createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile, readFile, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const exec = promisify(execFile);
const pollMs = Number(process.env.WORKER_POLL_MS ?? 15000);
const databaseUrl = process.env.DATABASE_URL;
const master = process.env.PLAY_PUBLISHER_MASTER_KEY;
if (!databaseUrl || !master) throw new Error("DATABASE_URL and PLAY_PUBLISHER_MASTER_KEY are required");

const client = new Client({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
await client.connect();

function decrypt(value) {
  const [iv, tag, body] = value.split(".");
  const key = createHash("sha256").update(master).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
}

async function run(command, args, cwd, env = {}) {
  const result = await exec(command, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 20 * 1024 * 1024 });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

async function claim() {
  await client.query("BEGIN");
  try {
    const result = await client.query(`
      SELECT j.*, a.repository_url, a.branch, a.project_path, a.package_name, a.version_name,
             s.encrypted_keystore, s.encrypted_store_password, s.encrypted_key_password, s.key_alias
      FROM play_publisher_jobs j
      JOIN play_publisher_apps a ON a.id=j.app_id
      LEFT JOIN play_publisher_signing s ON s.app_id=a.id AND s.user_id=a.user_id
      WHERE j.kind='build' AND j.status='queued'
      ORDER BY j.created_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    `);
    const job = result.rows[0];
    if (!job) { await client.query("COMMIT"); return null; }
    await client.query("UPDATE play_publisher_jobs SET status='running',started_at=NOW() WHERE id=$1", [job.id]);
    await client.query("COMMIT");
    return job;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function processJob(job) {
  const dir = await mkdtemp(path.join(tmpdir(), `viba-play-${job.id}-`));
  const logs = [];
  try {
    if (!job.encrypted_keystore) throw new Error("Android upload keystore is not configured for this app");
    const repoUrl = process.env.GITHUB_TOKEN && job.repository_url.startsWith("https://github.com/")
      ? job.repository_url.replace("https://", `https://x-access-token:${process.env.GITHUB_TOKEN}@`)
      : job.repository_url;
    logs.push(await run("git", ["clone", "--depth", "1", "--branch", job.branch, repoUrl, dir], process.cwd()));
    const root = path.resolve(dir, job.project_path ?? ".");
    const keystorePath = path.join(dir, ".viba-upload-keystore.jks");
    await writeFile(keystorePath, decrypt(job.encrypted_keystore));
    const storePassword = decrypt(job.encrypted_store_password).toString("utf8");
    const keyPassword = decrypt(job.encrypted_key_password).toString("utf8");
    const commands = job.input?.commands ?? ["pnpm install", "pnpm run build", "npx cap sync android", "./gradlew bundleRelease"];
    for (const line of commands) {
      const [command, ...args] = String(line).trim().split(/\s+/);
      const cwd = command === "./gradlew" ? path.join(root, "android") : root;
      logs.push(`$ ${line}\n${await run(command, args, cwd, {
        VIBA_KEYSTORE_PATH: keystorePath,
        VIBA_KEYSTORE_PASSWORD: storePassword,
        VIBA_KEY_ALIAS: job.key_alias,
        VIBA_KEY_PASSWORD: keyPassword,
      })}`);
    }
    const aab = path.join(root, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab");
    await stat(aab);
    const bytes = await readFile(aab);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const artifactDir = process.env.PLAY_ARTIFACT_DIR ?? "/data/play-artifacts";
    await exec("mkdir", ["-p", artifactDir]);
    const artifactPath = path.join(artifactDir, `${job.id}-${sha256}.aab`);
    await writeFile(artifactPath, bytes);
    await client.query(`UPDATE play_publisher_jobs SET status='completed',artifact_url=$1,artifact_sha256=$2,output=$3,completed_at=NOW() WHERE id=$4`, [
      `file://${artifactPath}`, sha256, { logs: logs.join("\n").slice(-500000), artifactPath }, job.id,
    ]);
  } catch (error) {
    await client.query("UPDATE play_publisher_jobs SET status='failed',error=$1,output=$2,completed_at=NOW() WHERE id=$3", [error instanceof Error ? error.message : String(error), { logs: logs.join("\n").slice(-500000) }, job.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (;;) {
  try {
    const job = await claim();
    if (job) await processJob(job);
    else await new Promise(resolve => setTimeout(resolve, pollMs));
  } catch (error) {
    console.error(error);
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
