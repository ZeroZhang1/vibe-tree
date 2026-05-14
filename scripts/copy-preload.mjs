import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const from = join(process.cwd(), "src/electron/preload.cjs");
const to = join(process.cwd(), "dist/electron/preload.cjs");
const rootPkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
writeFileSync(
  join(process.cwd(), "dist/electron/package.json"),
  JSON.stringify(
    {
      name: rootPkg.name,
      productName: rootPkg.productName,
      version: rootPkg.version,
      main: "main.js",
      type: "commonjs",
    },
    null,
    2,
  ),
  "utf8",
);
