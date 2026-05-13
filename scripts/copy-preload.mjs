import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const from = join(process.cwd(), "src/electron/preload.cjs");
const to = join(process.cwd(), "dist/electron/preload.cjs");

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
writeFileSync(join(process.cwd(), "dist/electron/package.json"), JSON.stringify({ type: "commonjs" }, null, 2), "utf8");
