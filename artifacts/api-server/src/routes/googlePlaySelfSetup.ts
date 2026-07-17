import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

router.post("/play-publisher/self-setup", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const { connectionId, privacyPolicyUrl = "https://viba.guru/privacy" } = req.body as { connectionId?: number; privacyPolicyUrl?: string };
    if (!connectionId) return res.status(400).json({ error: "Connect your Google Play account first" });
    const connection = await pool.query("SELECT id FROM play_publisher_connections WHERE id=$1 AND user_id=$2", [connectionId, userId]);
    if (!connection.rows[0]) return res.status(404).json({ error: "Google Play connection not found" });

    const result = await pool.query(`INSERT INTO play_publisher_apps
      (user_id,connection_id,name,package_name,repository_url,branch,project_path,framework,version_code,version_name,target_sdk,privacy_policy_url,status)
      VALUES($1,$2,'VIBA','guru.viba.app','https://github.com/leego972/viba.git','main','artifacts/bridge-ai','capacitor',1,'1.0',35,$3,'draft')
      ON CONFLICT(user_id,package_name) DO UPDATE SET connection_id=EXCLUDED.connection_id,repository_url=EXCLUDED.repository_url,branch=EXCLUDED.branch,project_path=EXCLUDED.project_path,framework=EXCLUDED.framework,target_sdk=EXCLUDED.target_sdk,privacy_policy_url=EXCLUDED.privacy_policy_url,updated_at=NOW()
      RETURNING *`, [userId, connectionId, privacyPolicyUrl]);

    res.json({ app: result.rows[0], defaultsApplied: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "VIBA setup failed" });
  }
});

export default router;
