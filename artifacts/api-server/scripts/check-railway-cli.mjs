import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main() {
  try {
    const { stdout } = await execFileAsync("railway", ["--version"], { timeout: 5000 });
    console.log(JSON.stringify({ railwayCliAvailable: true, version: stdout.trim() || "unknown" }, null, 2));
  } catch {
    console.log(JSON.stringify({ railwayCliAvailable: false, version: null }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
