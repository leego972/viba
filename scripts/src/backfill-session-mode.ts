import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function backfillSessionMode() {
  const client = await pool.connect();
  try {
    const { rows: sessions } = await client.query<{ id: number; mode: string }>(
      "SELECT id, mode FROM sessions"
    );

    console.log(`Backfilling mode for ${sessions.length} session(s)...`);

    let updated = 0;
    for (const session of sessions) {
      const { rows: agents } = await client.query<{ is_mock: boolean }>(
        "SELECT is_mock FROM agents WHERE session_id = $1",
        [session.id]
      );

      let mode: "live" | "simulation" | "mixed";
      if (agents.length === 0) {
        mode = "simulation";
      } else {
        const allMock = agents.every((a) => a.is_mock);
        const noneMock = agents.every((a) => !a.is_mock);
        mode = allMock ? "simulation" : noneMock ? "live" : "mixed";
      }

      if (session.mode !== mode) {
        await client.query("UPDATE sessions SET mode = $1 WHERE id = $2", [mode, session.id]);
        console.log(`  Session ${session.id}: "${session.mode}" -> "${mode}"`);
        updated++;
      } else {
        console.log(`  Session ${session.id}: already "${mode}", no change`);
      }
    }

    console.log(`Done. Updated ${updated} of ${sessions.length} session(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

backfillSessionMode().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
