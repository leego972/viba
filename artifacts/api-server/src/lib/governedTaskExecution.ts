import type { Agent, Task } from "@workspace/db";
import { routeTaskWithDecision, type RoutingDecision } from "./taskRouter";
import {
  validateTaskScope,
  type ActiveReservation,
  type ScopeValidationResult,
  type TaskContract,
} from "./orchestrationGovernance";

export interface GovernedRoutingInput {
  task: Task;
  agents: Agent[];
  contract: TaskContract;
  reservations: ActiveReservation[];
}

export interface GovernedRoutingDecision extends RoutingDecision {
  contractId: string;
  contractVersion: number;
  reservationConflicts: number[];
}

export function routeGovernedTask(input: GovernedRoutingInput): GovernedRoutingDecision {
  const conflicts = input.reservations
    .filter((reservation) => reservation.taskId !== input.task.id)
    .filter((reservation) =>
      reservation.paths.some((reserved) =>
        input.contract.allowedPaths.some((allowed) =>
          reserved === allowed || reserved.startsWith(`${allowed}/`) || allowed.startsWith(`${reserved}/`),
        ),
      ) || reservation.interfaces.some((name) => input.contract.ownedInterfaces.includes(name)),
    )
    .map((reservation) => reservation.taskId)
    .sort((a, b) => a - b);

  if (conflicts.length > 0) {
    return {
      agent: null,
      score: 0,
      qualityFloor: 0,
      estimatedRelativeCost: null,
      reason: `Task contract conflicts with active reservations: ${conflicts.join(", ")}`,
      contractId: input.contract.id,
      contractVersion: input.contract.version,
      reservationConflicts: conflicts,
    };
  }

  const routed = routeTaskWithDecision(input.task, input.agents);
  return {
    ...routed,
    contractId: input.contract.id,
    contractVersion: input.contract.version,
    reservationConflicts: [],
  };
}

export function validateGovernedDiff(contract: TaskContract, changedPaths: string[]): ScopeValidationResult {
  return validateTaskScope(contract, changedPaths);
}
