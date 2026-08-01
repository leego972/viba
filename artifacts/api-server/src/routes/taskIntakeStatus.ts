import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/task-intake/:taskId/status", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (typeof userId !== "number" || userId <= 0) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }

  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: "invalid_task_id" });
    return;
  }

  const { rows } = await pool.query<{
    id: number;
    status: string;
    risk_level: string;
    needs_user_approval: boolean;
    safe_build_required: boolean;
    safe_build_passed: boolean | null;
    approved_at: Date | null;
    cancelled_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, status, risk_level, needs_user_approval, safe_build_required,
            safe_build_passed, approved_at, cancelled_at, created_at, updated_at
       FROM viba_tasks
      WHERE id = $1 AND user_id = $2
      LIMIT 1`,
    [taskId, userId],
  );

  const task = rows[0];
  if (!task) {
    res.status(404).json({ error: "task_not_found" });
    return;
  }

  res.json({
    task_id: task.id,
    status: task.status,
    risk_level: task.risk_level,
    needs_user_approval: task.needs_user_approval,
    safe_build_required: task.safe_build_required,
    safe_build_passed: task.safe_build_passed,
    approved_at: task.approved_at,
    cancelled_at: task.cancelled_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
  });
});

export default router;
