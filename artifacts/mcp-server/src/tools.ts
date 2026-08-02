import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VibaApiError, VibaClient } from "./vibaClient.js";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  if (err instanceof VibaApiError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: err.message, status: err.status, body: err.body }, null, 2),
        },
      ],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

/**
 * Registers Viba's task-intake tools on an MCP server instance, bound to
 * one caller's VibaClient (one API key). Contract source:
 * artifacts/api-server/src/routes/taskIntake.ts and taskIntakeStatus.ts
 * (repo leego972/viba).
 */
export function registerVibaTools(server: McpServer, client: VibaClient): void {
  server.registerTool(
    "viba_create_mission",
    {
      title: "Create a Viba mission",
      description:
        "Start a new Viba mission by describing what you need done, in plain language. " +
        "Viba plans the work and returns a task_id plus the plan. Some missions require " +
        "user approval or a safe-build check before they can run — check the returned " +
        "status and plan for needs_user_approval / safe_build_required.",
      inputSchema: {
        request: z.string().min(3).max(4000).describe("Plain-language description of what Viba should do."),
      },
    },
    async ({ request }) => {
      try {
        return textResult(await client.createMission(request));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "viba_get_mission_status",
    {
      title: "Get Viba mission status",
      description:
        "Get the current status of a Viba mission: status, risk_level, whether it needs " +
        "user approval, and whether its safe-build check has passed. Use this to poll a " +
        "mission after creating it, rather than re-fetching the full task.",
      inputSchema: {
        task_id: z.number().int().positive().describe("The task_id returned by viba_create_mission."),
      },
    },
    async ({ task_id }) => {
      try {
        return textResult(await client.getMissionStatus(task_id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "viba_get_mission_plan",
    {
      title: "Get Viba mission plan",
      description: "Get the full plan Viba generated for a mission: steps, required agents, and required credentials.",
      inputSchema: {
        task_id: z.number().int().positive().describe("The task_id returned by viba_create_mission."),
      },
    },
    async ({ task_id }) => {
      try {
        return textResult(await client.getMissionPlan(task_id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "viba_approve_mission",
    {
      title: "Approve a Viba mission",
      description:
        "Approve a mission that is awaiting user approval, moving it to running. " +
        "Only call this after the user has actually reviewed and approved the plan — " +
        "do not approve on the user's behalf without their explicit confirmation.",
      inputSchema: {
        task_id: z.number().int().positive().describe("The task_id to approve."),
      },
    },
    async ({ task_id }) => {
      try {
        return textResult(await client.approveMission(task_id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "viba_cancel_mission",
    {
      title: "Cancel a Viba mission",
      description: "Cancel a Viba mission that hasn't completed yet.",
      inputSchema: {
        task_id: z.number().int().positive().describe("The task_id to cancel."),
      },
    },
    async ({ task_id }) => {
      try {
        return textResult(await client.cancelMission(task_id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "viba_get_evidence_report",
    {
      title: "Get a Viba mission's evidence report",
      description:
        "Get a summary evidence report for a mission: steps planned, agents used, " +
        "credentials referenced (by label only, never raw values), and whether the " +
        "result is deployment-ready. Useful once a mission has run.",
      inputSchema: {
        task_id: z.number().int().positive().describe("The task_id to report on."),
      },
    },
    async ({ task_id }) => {
      try {
        return textResult(await client.getEvidenceReport(task_id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
