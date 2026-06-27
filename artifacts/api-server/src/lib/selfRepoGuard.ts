export function configuredSelfRepo(): string {
  return process.env["VIBA_SELF_REPO"] || process.env["GITHUB_REPOSITORY"] || "leego972/bridge-ai";
}

export function normalizeRepoFullName(repo: string): string {
  return repo.trim().toLowerCase();
}

export function assertSelfRepo(repo: string): string {
  const normalized = normalizeRepoFullName(repo);
  const expected = normalizeRepoFullName(configuredSelfRepo());
  if (normalized !== expected) {
    throw new Error(`Self-repair is restricted to the configured VIBA source repo: ${configuredSelfRepo()}`);
  }
  return configuredSelfRepo();
}
