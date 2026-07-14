export const SELF_REPO_DEFAULT = "leego972/viba";
export const SELF_BRANCH_DEFAULT = "main";

export function configuredSelfRepo(): string {
  return process.env["VIBA_SELF_REPO"] || process.env["GITHUB_REPOSITORY"] || SELF_REPO_DEFAULT;
}

export function configuredSelfBranch(): string {
  return process.env["VIBA_SELF_BRANCH"] || SELF_BRANCH_DEFAULT;
}

export function validateRepoFormat(repo: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.trim());
}

export function normalizeRepoFullName(repo: string): string {
  return repo.trim().toLowerCase();
}

export function assertSelfRepo(repo: string): string {
  if (!validateRepoFormat(repo)) {
    throw new Error(`Invalid repo format "${repo}". Expected owner/name (e.g. leego972/viba).`);
  }
  const normalized = normalizeRepoFullName(repo);
  const expected = normalizeRepoFullName(configuredSelfRepo());
  if (normalized !== expected) {
    throw new Error(`Self-repair is restricted to the configured VIBA source repo: ${configuredSelfRepo()}`);
  }
  return configuredSelfRepo();
}

/** Spec alias: resolves the configured self-repo (env-aware). */
export function resolveSelfRepo(): string {
  return configuredSelfRepo();
}

/** Spec alias: resolves the configured self-branch (env-aware). */
export function resolveSelfBranch(): string {
  return configuredSelfBranch();
}

/** Spec: assert a repo name is safe (not a forbidden bridge-ai fallback) and valid. */
export function assertSafeRepo(repoFullName?: string): string {
  const target = (repoFullName ?? configuredSelfRepo()).trim();
  if (!validateRepoFormat(target)) {
    throw new Error(`Invalid repo format "${target}". Expected owner/name (e.g. leego972/viba).`);
  }
  const normalized = normalizeRepoFullName(target);
  const forbidden = ["leego972/bridge-ai", "bridge-ai/viba"];
  for (const f of forbidden) {
    if (normalized === f || normalized.endsWith(`/${f.split("/").pop()!}`) && normalized.startsWith("leego972/bridge")) {
      throw new Error(`"${target}" is a forbidden self-repo fallback. VIBA self-repo must be leego972/viba.`);
    }
  }
  return target;
}

/** Spec: return resolved repo/branch defaults as a plain serialisable object. */
export function selfRepoDefaults(): { repo: string; branch: string } {
  return { repo: configuredSelfRepo(), branch: configuredSelfBranch() };
}
