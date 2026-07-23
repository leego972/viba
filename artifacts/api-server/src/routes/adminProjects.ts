import { Router, type IRouter } from "express";
import { getAdminProject, listAdminProjects } from "../lib/userProjectStorage";
import { requireOwnerAdmin } from "../middlewares/requireOwnerAdmin";

const router: IRouter = Router();
router.use("/admin/projects", requireOwnerAdmin);

router.get("/admin/projects", async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.slice(0, 120) : "";
  const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 500);
  const projects = await listAdminProjects(search, limit);
  res.json({ projects, count: projects.length });
});

router.get("/admin/projects/:projectId", async (req, res): Promise<void> => {
  const project = await getAdminProject(String(req.params.projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ project, secretsReturned: false });
});

export default router;
