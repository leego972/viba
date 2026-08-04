import {
  agentsTable,
  architectureTwinSnapshotsTable,
  db,
  governanceReservationsTable,
  pool,
  taskContractsTable,
  tasksTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  ArchitectureDigitalTwin,
  type ArchitectureEdge,
  type ArchitectureNode,
  type ArchitectureTwinSnapshot,
} from "./architectureDigitalTwin";

export interface WorkspaceManifest {
  name: string;
  path: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface SessionArchitectureInput {
  sessionId: number;
  sourceRevision?: string;
  manifests: WorkspaceManifest[];
  tasks: Array<{
    id: number;
    title: string;
    type: string;
    status: string;
    assignedAgentId: number | null;
  }>;
  agents: Array<{
    id: number;
    name: string;
    provider: string;
    role: string;
  }>;
  contracts: Array<{
    id: number;
    taskId: number;
    version: number;
    allowedPaths: string[];
    ownedInterfaces: string[];
    dependencyTaskIds: number[];
  }>;
  reservations: Array<{
    taskId: number;
    resourceType: string;
    resourceKey: string;
    status: string;
  }>;
}

function packageNodeId(name: string): string {
  return `module:${name}`;
}

function externalNodeId(name: string): string {
  return `service:external:${name}`;
}

function addEdge(edges: Map<string, ArchitectureEdge>, edge: ArchitectureEdge): void {
  edges.set(`${edge.from}:${edge.type}:${edge.to}`, edge);
}

export function buildArchitectureTwin(input: SessionArchitectureInput): ArchitectureTwinSnapshot {
  const nodes = new Map<string, ArchitectureNode>();
  const edges = new Map<string, ArchitectureEdge>();
  const workspaceNames = new Set(input.manifests.map((manifest) => manifest.name));

  for (const manifest of input.manifests) {
    const moduleId = packageNodeId(manifest.name);
    nodes.set(moduleId, {
      id: moduleId,
      type: "module",
      label: manifest.name,
      paths: [manifest.path],
      metadata: {
        private: manifest.private ?? false,
        ...(manifest.metadata ?? {}),
      },
    });

    const dependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    };
    for (const [dependencyName, version] of Object.entries(dependencies)) {
      const dependencyId = workspaceNames.has(dependencyName)
        ? packageNodeId(dependencyName)
        : externalNodeId(dependencyName);
      if (!nodes.has(dependencyId)) {
        nodes.set(dependencyId, {
          id: dependencyId,
          type: "service",
          label: dependencyName,
          paths: [],
          metadata: { external: true, version },
        });
      }
      addEdge(edges, {
        from: moduleId,
        to: dependencyId,
        type: "depends_on",
        metadata: { version },
      });
    }
  }

  for (const agent of input.agents) {
    nodes.set(`operator:${agent.id}`, {
      id: `operator:${agent.id}`,
      type: "operator",
      label: agent.name,
      paths: [],
      metadata: { agentId: agent.id, provider: agent.provider, role: agent.role },
    });
  }

  const contractsByTask = new Map(input.contracts.map((contract) => [contract.taskId, contract]));
  for (const task of input.tasks) {
    const contract = contractsByTask.get(task.id);
    const taskReservations = input.reservations.filter(
      (reservation) => reservation.taskId === task.id && reservation.status === "active",
    );
    const reservedPaths = taskReservations
      .filter((reservation) => reservation.resourceType === "path")
      .map((reservation) => reservation.resourceKey);
    const reservedInterfaces = taskReservations
      .filter((reservation) => reservation.resourceType === "interface")
      .map((reservation) => reservation.resourceKey);
    const taskId = `task:${task.id}`;

    nodes.set(taskId, {
      id: taskId,
      type: "task",
      label: task.title,
      paths: contract?.allowedPaths ?? [],
      metadata: {
        taskId: task.id,
        taskType: task.type,
        status: task.status,
        contractId: contract?.id ?? null,
        contractVersion: contract?.version ?? null,
        reservedPaths,
        reservedInterfaces,
      },
    });

    if (task.assignedAgentId !== null && nodes.has(`operator:${task.assignedAgentId}`)) {
      addEdge(edges, { from: `operator:${task.assignedAgentId}`, to: taskId, type: "owns" });
    }

    for (const path of contract?.allowedPaths ?? []) {
      const matchingModules = [...nodes.values()].filter(
        (node) => node.type === "module" && node.paths.some((modulePath) =>
          path === modulePath || path.startsWith(`${modulePath}/`) || modulePath.startsWith(`${path}/`),
        ),
      );
      for (const moduleNode of matchingModules) {
        addEdge(edges, { from: taskId, to: moduleNode.id, type: "affects", metadata: { path } });
      }
    }

    for (const interfaceName of contract?.ownedInterfaces ?? []) {
      const interfaceId = `interface:${interfaceName}`;
      if (!nodes.has(interfaceId)) {
        nodes.set(interfaceId, {
          id: interfaceId,
          type: "interface",
          label: interfaceName,
          paths: [],
        });
      }
      addEdge(edges, { from: taskId, to: interfaceId, type: "implements" });
    }

    for (const dependencyTaskId of contract?.dependencyTaskIds ?? []) {
      const dependencyId = `task:${dependencyTaskId}`;
      if (input.tasks.some((candidate) => candidate.id === dependencyTaskId)) {
        addEdge(edges, { from: taskId, to: dependencyId, type: "depends_on" });
      }
    }
  }

  const twin = new ArchitectureDigitalTwin({
    version: 1,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    generatedAt: new Date().toISOString(),
  });
  return twin.snapshot();
}

let snapshotTableReady: Promise<void> | null = null;

async function ensureSnapshotTable(): Promise<void> {
  snapshotTableReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS architecture_twin_snapshots (
      id serial PRIMARY KEY,
      session_id integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      version integer NOT NULL,
      source_revision text,
      node_count integer NOT NULL,
      edge_count integer NOT NULL,
      snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT architecture_twin_session_version_uq UNIQUE(session_id, version)
    );
    CREATE INDEX IF NOT EXISTS architecture_twin_latest_idx
      ON architecture_twin_snapshots(session_id, version DESC);
  `).then(() => undefined);
  return snapshotTableReady;
}

export async function loadSessionArchitectureInput(input: {
  sessionId: number;
  manifests: WorkspaceManifest[];
  sourceRevision?: string;
}): Promise<SessionArchitectureInput> {
  const [tasks, agents, contracts, reservations] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.sessionId, input.sessionId)),
    db.select().from(agentsTable).where(eq(agentsTable.sessionId, input.sessionId)),
    db.select().from(taskContractsTable).where(
      and(eq(taskContractsTable.sessionId, input.sessionId), eq(taskContractsTable.status, "active")),
    ),
    db.select().from(governanceReservationsTable).where(eq(governanceReservationsTable.sessionId, input.sessionId)),
  ]);

  return {
    sessionId: input.sessionId,
    sourceRevision: input.sourceRevision,
    manifests: input.manifests,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      type: task.type,
      status: task.status,
      assignedAgentId: task.assignedAgentId,
    })),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      provider: agent.provider,
      role: agent.role,
    })),
    contracts: contracts.map((contract) => ({
      id: contract.id,
      taskId: contract.taskId,
      version: contract.version,
      allowedPaths: contract.allowedPaths,
      ownedInterfaces: contract.ownedInterfaces,
      dependencyTaskIds: contract.dependencyTaskIds,
    })),
    reservations: reservations.map((reservation) => ({
      taskId: reservation.taskId,
      resourceType: reservation.resourceType,
      resourceKey: reservation.resourceKey,
      status: reservation.status,
    })),
  };
}

export async function refreshArchitectureTwin(input: {
  sessionId: number;
  manifests: WorkspaceManifest[];
  sourceRevision?: string;
}): Promise<ArchitectureTwinSnapshot> {
  await ensureSnapshotTable();
  const source = await loadSessionArchitectureInput(input);
  const generated = buildArchitectureTwin(source);
  const [latest] = await db
    .select({ version: architectureTwinSnapshotsTable.version })
    .from(architectureTwinSnapshotsTable)
    .where(eq(architectureTwinSnapshotsTable.sessionId, input.sessionId))
    .orderBy(desc(architectureTwinSnapshotsTable.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const snapshot: ArchitectureTwinSnapshot = { ...generated, version };

  await db.insert(architectureTwinSnapshotsTable).values({
    sessionId: input.sessionId,
    version,
    sourceRevision: input.sourceRevision,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    snapshot: snapshot as unknown as Record<string, unknown>,
  });
  return snapshot;
}

export async function getLatestArchitectureTwin(sessionId: number): Promise<ArchitectureTwinSnapshot | null> {
  await ensureSnapshotTable();
  const [row] = await db
    .select({ snapshot: architectureTwinSnapshotsTable.snapshot })
    .from(architectureTwinSnapshotsTable)
    .where(eq(architectureTwinSnapshotsTable.sessionId, sessionId))
    .orderBy(desc(architectureTwinSnapshotsTable.version))
    .limit(1);
  return row ? row.snapshot as unknown as ArchitectureTwinSnapshot : null;
}
