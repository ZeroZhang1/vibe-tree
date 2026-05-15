import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const timeoutMs = Number(process.env.VIBE_TREE_SMOKE_TIMEOUT_MS ?? 8_000);
const mainPath = join(process.cwd(), "dist/electron/main.js");
const windowsElectronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");

if (!existsSync(mainPath)) {
  console.error(`Missing Electron main bundle: ${mainPath}`);
  process.exit(1);
}

const command =
  process.platform === "linux" && !process.env.DISPLAY && existsSync("/usr/bin/xvfb-run")
    ? "/usr/bin/xvfb-run"
    : process.platform === "win32"
      ? windowsElectronPath
      : "npx";
const electronArgs = [...(process.platform === "linux" ? ["--no-sandbox"] : []), mainPath];
const args =
  command.endsWith("xvfb-run") || command.endsWith("xvfb-run.exe")
    ? ["-a", "npx", "electron", ...electronArgs]
    : command === windowsElectronPath
      ? electronArgs
    : ["electron", ...electronArgs];
const env = {
  ...process.env,
  VIBE_TREE_SMOKE_TEST: "1",
};
if (process.platform === "linux") {
  env.ELECTRON_DISABLE_SANDBOX = "1";
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
let settled = false;

const collect = (chunk) => {
  output = `${output}${chunk.toString("utf8")}`.slice(-20_000);
};

child.stdout.on("data", collect);
child.stderr.on("data", collect);

const finish = (code, message) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  if (!child.killed) child.kill();
  if (code !== 0) {
    console.error(message);
    if (output.trim()) console.error(output.trim());
  }
  process.exit(code);
};

const timer = setTimeout(() => {
  finish(1, `Electron smoke test timed out after ${timeoutMs}ms.`);
}, timeoutMs);

child.on("error", (error) => {
  finish(1, `Electron smoke test could not start: ${error.message}`);
});

child.on("exit", (code, signal) => {
  if (code === 0) {
    finish(0, "");
    return;
  }
  finish(1, `Electron smoke test failed (${code ?? signal ?? "unknown"}).`);
});
