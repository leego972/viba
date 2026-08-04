export type ArchitectureNodeType =
  | "module"
  | "service"
  | "interface"
  | "database"
  | "deployment"
  | "operator"
  | "task";

export type ArchitectureEdgeType =
  | "depends_on"
  | "implements"
  | "owns"
  | "reads"
  | "writes"
  | "deploys_to"
  | "reserved_by"
  | "affects";

export interface ArchitectureNode {
  id: string;
  type: ArchitectureNodeType;
  label: string;
  paths: string[];
  metadata?: Record<string, unknown>;
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  type: ArchitectureEdgeType;
  metadata?: Record<string, unknown>;
}

export interface ArchitectureTwinSnapshot {
  version: number;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  generatedAt: string;
}

export interface ChangeIntent {
  taskId: number;
  agentId?: number;
  changedPaths: string[];
  changedInterfaces: string[];
  dependencyChanges?: Array<{ from: string; to: string; operation: "add" | "remove" }>;
  estimatedMonthlyCostDelta?: number;
  destructiveMigration?: boolean;
  publicContractChange?: boolean;
}

export interface ImpactedNode {
  nodeId: string;
  reason: string;
  distance: number;
}

export interface ArchitectureImpactReport {
  impactedNodes: ImpactedNode[];
  conflictingTaskIds: number[];
  affectedModules: string[];
  affectedInterfaces: string[];
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiredReviews: string[];
  reasons: string[];
  allowed: boolean;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function pathsOverlap(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function riskLevel(score: number): ArchitectureImpactReport["riskLevel"] {
  if (score >= 80) return "critical";
  if (score >= 55) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export class ArchitectureDigitalTwin {
  private readonly nodes = new Map<string, ArchitectureNode>();
  private readonly outgoing = new Map<string, ArchitectureEdge[]>();
  private readonly incoming = new Map<string, ArchitectureEdge[]>();
  private version = 1;

  constructor(snapshot?: ArchitectureTwinSnapshot) {
    if (!snapshot) return;
    this.version = snapshot.version;
    for (const node of snapshot.nodes) this.upsertNode(node, false);
    for (const edge of snapshot.edges) this.upsertEdge(edge, false);
  }

  upsertNode(node: ArchitectureNode, incrementVersion = true): void {
    this.nodes.set(node.id, {
      ...node,
      paths: [...new Set(node.paths.map(normalizePath))],
      metadata: node.metadata ? { ...node.metadata } : undefined,
    });
    if (incrementVersion) this.version += 1;
  }

  upsertEdge(edge: ArchitectureEdge, incrementVersion = true): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(`Architecture edge references an unknown node: ${edge.from} -> ${edge.to}`);
    }

    const key = `${edge.from}:${edge.type}:${edge.to}`;
    const replace = (edges: ArchitectureEdge[]) => [
      ...edges.filter((candidate) => `${candidate.from}:${candidate.type}:${candidate.to}` !== key),
      { ...edge, metadata: edge.metadata ? { ...edge.metadata } : undefined },
    ];
    this.outgoing.set(edge.from, replace(this.outgoing.get(edge.from) ?? []));
    this.incoming.set(edge.to, replace(this.incoming.get(edge.to) ?? []));
    if (incrementVersion) this.version += 1;
  }

  removeNode(nodeId: string): void {
    if (!this.nodes.delete(nodeId)) return;
    for (const edge of this.outgoing.get(nodeId) ?? []) {
      this.incoming.set(edge.to, (this.incoming.get(edge.to) ?? []).filter((candidate) => candidate.from !== nodeId));
    }
    for (const edge of this.incoming.get(nodeId) ?? []) {
      this.outgoing.set(edge.from, (this.outgoing.get(edge.from) ?? []).filter((candidate) => candidate.to !== nodeId));
    }
    this.outgoing.delete(nodeId);
    this.incoming.delete(nodeId);
    this.version += 1;
  }

  snapshot(): ArchitectureTwinSnapshot {
    const edgeMap = new Map<string, ArchitectureEdge>();
    for (const edges of this.outgoing.values()) {
      for (const edge of edges) edgeMap.set(`${edge.from}:${edge.type}:${edge.to}`, edge);
    }
    return {
      version: this.version,
      nodes: [...this.nodes.values()].map((node) => ({ ...node, paths: [...node.paths] })),
      edges: [...edgeMap.values()].map((edge) => ({ ...edge })),
      generatedAt: new Date().toISOString(),
    };
  }

  findNodesByPath(path: string): ArchitectureNode[] {
    const normalized = normalizePath(path);
    return [...this.nodes.values()].filter((node) => node.paths.some((candidate) => pathsOverlap(candidate, normalized)));
  }

  analyzeChange(intent: ChangeIntent): ArchitectureImpactReport {
    const directNodeIds = new Set<string>();
    const affectedInterfaces = new Set(intent.changedInterfaces);
    const conflictingTaskIds = new Set<number>();
    const reasons: string[] = [];
    const requiredReviews = new Set<string>();

    for (const path of intent.changedPaths) {
      for (const node of this.findNodesByPath(path)) directNodeIds.add(node.id);
    }

    for (const interfaceName of intent.changedInterfaces) {
      for (const node of this.nodes.values()) {
        const declaredInterface = node.type === "interface" && (node.id === interfaceName || node.label === interfaceName);
        if (declaredInterface) directNodeIds.add(node.id);
      }
    }

    for (const node of this.nodes.values()) {
      if (node.type !== "task") continue;
      const taskId = Number(node.metadata?.["taskId"]);
      if (!Number.isSafeInteger(taskId) || taskId === intent.taskId) continue;
      const reservedPaths = Array.isArray(node.metadata?.["reservedPaths"])
        ? (node.metadata?.["reservedPaths"] as string[])
        : [];
      const reservedInterfaces = Array.isArray(node.metadata?.["reservedInterfaces"])
        ? (node.metadata?.["reservedInterfaces"] as string[])
        : [];
      const pathConflict = intent.changedPaths.some((path) => reservedPaths.some((reserved) => pathsOverlap(path, reserved)));
      const interfaceConflict = intent.changedInterfaces.some((name) => reservedInterfaces.includes(name));
      if (pathConflict || interfaceConflict) conflictingTaskIds.add(taskId);
    }

    const impacted = new Map<string, ImpactedNode>();
    const queue: Array<{ nodeId: string; distance: number; reason: string }> = [...directNodeIds].map((nodeId) => ({
      nodeId,
      distance: 0,
      reason: "Direct path or interface match",
    }));

    while (queue.length > 0) {
      const current = queue.shift()!;
      const existing = impacted.get(current.nodeId);
      if (existing && existing.distance <= current.distance) continue;
      impacted.set(current.nodeId, current);
      if (current.distance >= 3) continue;

      const edges = [...(this.outgoing.get(current.nodeId) ?? []), ...(this.incoming.get(current.nodeId) ?? [])];
      for (const edge of edges) {
        const nextId = edge.from === current.nodeId ? edge.to : edge.from;
        queue.push({
          nodeId: nextId,
          distance: current.distance + 1,
          reason: `${edge.type} relation with ${current.nodeId}`,
        });
      }
    }

    const affectedModules = [...impacted.keys()]
      .map((nodeId) => this.nodes.get(nodeId))
      .filter((node): node is ArchitectureNode => node?.type === "module")
      .map((node) => node.id);

    let score = Math.min(30, directNodeIds.size * 5) + Math.min(25, impacted.size * 2);
    if (conflictingTaskIds.size > 0) {
      score += 40;
      reasons.push(`Conflicts with active task reservations: ${[...conflictingTaskIds].join(", ")}`);
    }
    if (intent.publicContractChange) {
      score += 25;
      requiredReviews.add("architecture");
      requiredReviews.add("api-compatibility");
      reasons.push("Public contract change detected.");
    }
    if (intent.destructiveMigration) {
      score += 35;
      requiredReviews.add("database");
      requiredReviews.add("security");
      reasons.push("Destructive database migration detected.");
    }
    if ((intent.estimatedMonthlyCostDelta ?? 0) > 0) {
      score += Math.min(20, Math.ceil((intent.estimatedMonthlyCostDelta ?? 0) / 10));
      requiredReviews.add("cost");
      reasons.push("Recurring infrastructure cost increase detected.");
    }
    if ((intent.dependencyChanges?.length ?? 0) > 0) {
      score += Math.min(20, (intent.dependencyChanges?.length ?? 0) * 5);
      requiredReviews.add("architecture");
      requiredReviews.add("security");
      reasons.push("Dependency graph changes detected.");
    }
    if (affectedInterfaces.size > 0) requiredReviews.add("integration");
    if (affectedModules.length >= 3) requiredReviews.add("regression");

    score = Math.min(100, score);
    const level = riskLevel(score);
    if (level === "high" || level === "critical") requiredReviews.add("independent-qa");
    if (directNodeIds.size === 0) reasons.push("No architecture node matched the proposed paths or interfaces.");

    return {
      impactedNodes: [...impacted.values()].sort((left, right) => left.distance - right.distance || left.nodeId.localeCompare(right.nodeId)),
      conflictingTaskIds: [...conflictingTaskIds].sort((a, b) => a - b),
      affectedModules: [...new Set(affectedModules)].sort(),
      affectedInterfaces: [...affectedInterfaces].sort(),
      riskScore: score,
      riskLevel: level,
      requiredReviews: [...requiredReviews].sort(),
      reasons,
      allowed: conflictingTaskIds.size === 0 && level !== "critical",
    };
  }
}
