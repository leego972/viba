import { Router, type IRouter } from "express";
import {
  createProjectVersion,
  createUserProject,
  finalizeProjectVersion,
  getOwnedProject,
  listUserProjects,
  saveProjectFile,
} from "../lib/userProjectStorage";

const router: IRouter = Router();

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" && req.session.userId > 0 ? req.session.userId : null;
}

router.get("/projects", async (req, res): Promise<void> => {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return; }
  res.json({ projects: await listUserProjects(uid), storage: "persistent_server_storage" });
});

router.post("/projects", async (req, res): Promise<void> => {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return; }
  const body = req.body as { name?: string; description?: string; source?: string };
  try {
    const project = await createUserProject({ userId: uid, name: body.name ?? "", description: body.description, source: body.source });
    res.status(201).json({ project });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not create project" });
  }
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return; }
  const project = await getOwnedProject(uid, String(req.params.projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json({ project });
});

router.post("/projects/:projectId/versions", async (req, res): Promise<void> => {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const version = await createProjectVersion({
      userId: uid,
      projectId: String(req.params.projectId),
      label: typeof req.body?.label === "string" ? req.body.label : undefined,
    });
    res.status(201).json({ version });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not create project version" });
  }
});

router.put("/projects/:projectId/versions/:versionId/files", async (req, res): Promise<void> => {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return; }
  const body = req.body as { path?: string; contentBase64?: string; content?: string; mimeType?: string };
  if (!body.path || (body.contentBase64 === undefined && body.content === undefined)) {
    res.status(400).json({ error: "path and contentBase64 or content are required" });
    return;
  }
  try {
    const content = body.contentBase64 !== undefined
      ? Buffer.from(body.contentBase64, "base64")
      : Buffer.from(body.content ?? "", "utf8");
    const file = await saveProjectFile({
      userId: uid,
      projectId: String(req.params.projectId),
      versionId: String(req.params.versionId),
      relativePath: body.path,
      content,
      mimeType: body.mimeType,
    });
    res.json({ file });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not save project file" });
  }
});

router.post("/projects/:projectId/versions/:versionId/finalize", async (req, res): Promise<void> => {
  const uid = userId(req);
  if (!uid) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    await finalizeProjectVersion(uid, String(req.params.projectId), String(req.params.versionId));
    res.json({ ok: true, status: "complete" });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not finalize project version" });
  }
});

export default router;
