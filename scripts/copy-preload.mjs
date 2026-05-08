import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const from = join(process.cwd(), "src/electron/preload.cjs");
const to = join(process.cwd(), "dist/electron/preload.cjs");

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
