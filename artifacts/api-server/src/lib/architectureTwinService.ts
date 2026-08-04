import type { ArchitectureTwinSnapshot } from "./architectureDigitalTwin";
import { refreshArchitectureTwin } from "./architectureGraphStore";
import { discoverWorkspaceManifests } from "./workspaceManifestDiscovery";

export async function refreshSessionArchitectureTwin(input: {
  sessionId: number;
  repositoryRoot?: string;
  sourceRevision?: string;
}): Promise<ArchitectureTwinSnapshot> {
  const manifests = await discoverWorkspaceManifests(
    input.repositoryRoot ? { repositoryRoot: input.repositoryRoot } : undefined,
  );
  return refreshArchitectureTwin({
    sessionId: input.sessionId,
    manifests,
    ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
  });
}
