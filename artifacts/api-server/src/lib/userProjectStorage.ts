import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PROJECT_FILES = 5000;
let ensurePromise: Promise<void> | null = null;

export interface StoredProject {
  id: string;
  userId: number;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  source: string;
  latestVersion: number;
  totalBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredProjectVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  label: string | null;
  status: string;
  fileCount: number;
  totalBytes: number;
  manifestSha256: string | null;
  createdAt: Date;
}

function storageRoot(): string {
  const configured = process.env.VIBA_PROJECT_STORAGE_ROOT?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") {
    throw new Error("VIBA_PROJECT_STORAGE_ROOT must point to a mounted Render persistent disk in production.");
  }
  return path.resolve(process.cwd(), ".viba-project-storage");
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "project";
}

function safeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error("Invalid project file path.");
  }
  const relative = parts.join("/");
  if (relative.length > 500) throw new Error("Project file path is too long.");
  return relative;
}

function projectDirectory(userId: number, projectId: string): string {
  return path.join(storageRoot(), "users", String(userId), "projects", projectId);
}

function versionDirectory(userId: number, projectId: string, versionId: string): string {
  return path.join(projectDirectory(userId, projectId), "versions", versionId);
}

export async function ensureProjectStorage(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS viba_user_projects (
          id UUID PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          source TEXT NOT NULL DEFAULT 'viba_builder',
          latest_version INTEGER NOT NULL DEFAULT 0,
          total_bytes BIGINT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, slug)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS viba_project_versions (
          id UUID PRIMARY KEY,
          project_id UUID NOT NULL REFERENCES viba_user_projects(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          label TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          file_count INTEGER NOT NULL DEFAULT 0,
          total_bytes BIGINT NOT NULL DEFAULT 0,
          manifest_sha256 TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, version_number)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS viba_project_files (
          id UUID PRIMARY KEY,
          version_id UUID NOT NULL REFERENCES viba_project_versions(id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          size_bytes BIGINT NOT NULL,
          sha256 TEXT NOT NULL,
          mime_type TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(version_id, relative_path)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_projects_user ON viba_user_projects(user_id, updated_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_viba_versions_project ON viba_project_versions(project_id, version_number DESC)`);
      await fs.mkdir(storageRoot(), { recursive: true, mode: 0o750 });
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

function mapProject(row: Record<string, unknown>): StoredProject {
  return {
    id: String(row.id), userId: Number(row.user_id), name: String(row.name), slug: String(row.slug),
    description: row.description ? String(row.description) : null, status: String(row.status), source: String(row.source),
    latestVersion: Number(row.latest_version), totalBytes: Number(row.total_bytes),
    createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
  };
}

export async function createUserProject(input: { userId: number; name: string; description?: string; source?: string }): Promise<StoredProject> {
  await ensureProjectStorage();
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Project name is required.");
  const baseSlug = slugify(name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = crypto.randomUUID();
    try {
      const { rows } = await pool.query<Record<string, unknown>>(
        `INSERT INTO viba_user_projects (id, user_id, name, slug, description, source)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, input.userId, name, slug, input.description?.trim().slice(0, 1000) || null, input.source?.slice(0, 80) || "viba_builder"],
      );
      await fs.mkdir(projectDirectory(input.userId, id), { recursive: true, mode: 0o750 });
      return mapProject(rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      slug = `${baseSlug}-${attempt + 2}`;
    }
  }
  throw new Error("Could not allocate a unique project slug.");
}

export async function listUserProjects(userId: number): Promise<StoredProject[]> {
  await ensureProjectStorage();
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_user_projects WHERE user_id=$1 ORDER BY updated_at DESC`, [userId],
  );
  return rows.map(mapProject);
}

export async function getOwnedProject(userId: number, projectId: string): Promise<StoredProject | null> {
  await ensureProjectStorage();
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM viba_user_projects WHERE id=$1 AND user_id=$2 LIMIT 1`, [projectId, userId],
  );
  return rows[0] ? mapProject(rows[0]) : null;
}

export async function createProjectVersion(input: { userId: number; projectId: string; label?: string }): Promise<StoredProjectVersion> {
  await ensureProjectStorage();
  const project = await getOwnedProject(input.userId, input.projectId);
  if (!project) throw new Error("Project not found.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: projectRows } = await client.query<{ latest_version: number }>(
      `SELECT latest_version FROM viba_user_projects WHERE id=$1 AND user_id=$2 FOR UPDATE`, [input.projectId, input.userId],
    );
    if (!projectRows[0]) throw new Error("Project not found.");
    const versionNumber = projectRows[0].latest_version + 1;
    const id = crypto.randomUUID();
    const { rows } = await client.query<Record<string, unknown>>(
      `INSERT INTO viba_project_versions (id, project_id, version_number, label)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, input.projectId, versionNumber, input.label?.trim().slice(0, 120) || null],
    );
    await client.query(`UPDATE viba_user_projects SET latest_version=$1, updated_at=NOW() WHERE id=$2`, [versionNumber, input.projectId]);
    await client.query("COMMIT");
    await fs.mkdir(versionDirectory(input.userId, input.projectId, id), { recursive: true, mode: 0o750 });
    const row = rows[0]!;
    return {
      id: String(row.id), projectId: String(row.project_id), versionNumber: Number(row.version_number),
      label: row.label ? String(row.label) : null, status: String(row.status), fileCount: Number(row.file_count),
      totalBytes: Number(row.total_bytes), manifestSha256: row.manifest_sha256 ? String(row.manifest_sha256) : null,
      createdAt: new Date(String(row.created_at)),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function saveProjectFile(input: {
  userId: number; projectId: string; versionId: string; relativePath: string; content: Buffer; mimeType?: string;
}): Promise<{ relativePath: string; sizeBytes: number; sha256: string }> {
  await ensureProjectStorage();
  if (input.content.byteLength > MAX_FILE_BYTES) throw new Error(`Files may not exceed ${MAX_FILE_BYTES} bytes.`);
  const project = await getOwnedProject(input.userId, input.projectId);
  if (!project) throw new Error("Project not found.");
  const { rows: versionRows } = await pool.query<{ id: string; status: string }>(
    `SELECT v.id, v.status FROM viba_project_versions v JOIN viba_user_projects p ON p.id=v.project_id
     WHERE v.id=$1 AND p.id=$2 AND p.user_id=$3 LIMIT 1`, [input.versionId, input.projectId, input.userId],
  );
  if (!versionRows[0]) throw new Error("Project version not found.");
  if (versionRows[0].status !== "draft") throw new Error("Only draft versions can be modified.");
  const { rows: countRows } = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM viba_project_files WHERE version_id=$1`, [input.versionId]);
  if (Number(countRows[0]?.count ?? 0) >= MAX_PROJECT_FILES) throw new Error("Project version file limit reached.");

  const relativePath = safeRelativePath(input.relativePath);
  const base = versionDirectory(input.userId, input.projectId, input.versionId);
  const destination = path.resolve(base, relativePath);
  if (!destination.startsWith(`${path.resolve(base)}${path.sep}`)) throw new Error("Invalid project file path.");
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, input.content, { mode: 0o640 });
  await fs.rename(temporary, destination);

  const sha256 = crypto.createHash("sha256").update(input.content).digest("hex");
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO viba_project_files (id, version_id, relative_path, size_bytes, sha256, mime_type)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (version_id, relative_path) DO UPDATE SET size_bytes=EXCLUDED.size_bytes, sha256=EXCLUDED.sha256, mime_type=EXCLUDED.mime_type, created_at=NOW()`,
    [id, input.versionId, relativePath, input.content.byteLength, sha256, input.mimeType?.slice(0, 120) || null],
  );
  await pool.query(
    `UPDATE viba_project_versions SET file_count=(SELECT COUNT(*) FROM viba_project_files WHERE version_id=$1),
       total_bytes=(SELECT COALESCE(SUM(size_bytes),0) FROM viba_project_files WHERE version_id=$1) WHERE id=$1`, [input.versionId],
  );
  return { relativePath, sizeBytes: input.content.byteLength, sha256 };
}

export async function finalizeProjectVersion(userId: number, projectId: string, versionId: string): Promise<void> {
  await ensureProjectStorage();
  const { rows } = await pool.query<{ relative_path: string; sha256: string; size_bytes: string }>(
    `SELECT f.relative_path, f.sha256, f.size_bytes::text FROM viba_project_files f
     JOIN viba_project_versions v ON v.id=f.version_id JOIN viba_user_projects p ON p.id=v.project_id
     WHERE f.version_id=$1 AND p.id=$2 AND p.user_id=$3 ORDER BY f.relative_path`, [versionId, projectId, userId],
  );
  const manifest = JSON.stringify(rows);
  const manifestSha256 = crypto.createHash("sha256").update(manifest).digest("hex");
  const totalBytes = rows.reduce((sum, row) => sum + Number(row.size_bytes), 0);
  await pool.query(
    `UPDATE viba_project_versions SET status='complete', manifest_sha256=$1 WHERE id=$2 AND project_id=$3`, [manifestSha256, versionId, projectId],
  );
  await pool.query(`UPDATE viba_user_projects SET total_bytes=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3`, [totalBytes, projectId, userId]);
  await fs.writeFile(path.join(versionDirectory(userId, projectId, versionId), "manifest.json"), manifest, { mode: 0o640 });
}

export async function listAdminProjects(search = "", limit = 200): Promise<Record<string, unknown>[]> {
  await ensureProjectStorage();
  const pattern = `%${search.trim().toLowerCase()}%`;
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT p.id, p.user_id, u.email, u.name AS user_name, p.name, p.slug, p.description, p.status, p.source,
            p.latest_version, p.total_bytes, p.created_at, p.updated_at,
            (SELECT COUNT(*)::int FROM viba_project_versions v WHERE v.project_id=p.id) AS version_count
       FROM viba_user_projects p JOIN users u ON u.id=p.user_id
      WHERE ($1='' OR LOWER(p.name) LIKE $2 OR LOWER(u.email) LIKE $2)
      ORDER BY p.updated_at DESC LIMIT $3`, [search.trim(), pattern, Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
}

export async function getAdminProject(projectId: string): Promise<Record<string, unknown> | null> {
  await ensureProjectStorage();
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT p.*, u.email, u.name AS user_name FROM viba_user_projects p JOIN users u ON u.id=p.user_id WHERE p.id=$1 LIMIT 1`, [projectId],
  );
  if (!rows[0]) return null;
  const { rows: versions } = await pool.query<Record<string, unknown>>(
    `SELECT v.*, (SELECT json_agg(json_build_object('relativePath',f.relative_path,'sizeBytes',f.size_bytes,'sha256',f.sha256,'mimeType',f.mime_type) ORDER BY f.relative_path)
      FROM viba_project_files f WHERE f.version_id=v.id) AS files
      FROM viba_project_versions v WHERE v.project_id=$1 ORDER BY v.version_number DESC`, [projectId],
  );
  return { ...rows[0], versions };
}
