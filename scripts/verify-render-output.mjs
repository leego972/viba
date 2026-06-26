import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const requiredPaths = [
  "artifacts/api-server/dist/index.mjs",
  "artifacts/bridge-ai/dist/public/index.html",
];

const missing = requiredPaths.filter((relativePath) => !existsSync(path.resolve(process.cwd(), relativePath)));

if (missing.length > 0) {
  console.error("Render build output check did not find required files:");
  for (const item of missing) console.error(`- ${item}`);
  process.exitCode = 1;
} else {
  console.log("Render build output check passed.");
}
