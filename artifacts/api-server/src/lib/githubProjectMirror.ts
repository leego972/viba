import {
  createProjectVersion,
  createUserProject,
  finalizeProjectVersion,
  listUserProjects,
  saveProjectFile,
} from "./userProjectStorage";

function repoSlug(owner: string, repo: string): string {
  return `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export async function ensureGithubStoredProject(input: {
  userId: number;
  owner: string;
  repo: string;
  description?: string;
}): Promise<{ id: string; name: string }> {
  const slug = repoSlug(input.owner, input.repo);
  const existing = (await listUserProjects(input.userId)).find(
    (project) => project.slug === slug && project.source === "github",
  );
  if (existing) return { id: existing.id, name: existing.name };

  const created = await createUserProject({
    userId: input.userId,
    name: `${input.owner}/${input.repo}`,
    description: input.description ?? `GitHub repository ${input.owner}/${input.repo}`,
    source: "github",
  });
  return { id: created.id, name: created.name };
}

export async function mirrorGithubFileCommit(input: {
  userId: number;
  owner: string;
  repo: string;
  filePath: string;
  content: string;
  commitSha?: string;
  branch?: string;
  message: string;
}): Promise<{ projectId: string; versionId: string; versionNumber: number }> {
  const project = await ensureGithubStoredProject(input);
  const version = await createProjectVersion({
    userId: input.userId,
    projectId: project.id,
    label: input.commitSha
      ? `GitHub ${input.commitSha.slice(0, 12)} — ${input.message}`
      : `GitHub update — ${input.message}`,
  });

  await saveProjectFile({
    userId: input.userId,
    projectId: project.id,
    versionId: version.id,
    relativePath: input.filePath,
    content: Buffer.from(input.content, "utf8"),
    mimeType: "text/plain; charset=utf-8",
  });

  const metadata = JSON.stringify({
    repository: `${input.owner}/${input.repo}`,
    branch: input.branch ?? null,
    commitSha: input.commitSha ?? null,
    message: input.message,
    snapshotType: "committed_file_delta",
  }, null, 2);
  await saveProjectFile({
    userId: input.userId,
    projectId: project.id,
    versionId: version.id,
    relativePath: ".viba/version.json",
    content: Buffer.from(metadata, "utf8"),
    mimeType: "application/json",
  });

  await finalizeProjectVersion(input.userId, project.id, version.id);
  return { projectId: project.id, versionId: version.id, versionNumber: version.versionNumber };
}
