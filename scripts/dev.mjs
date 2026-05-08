import { spawn } from "node:child_process";
import http from "node:http";

const vite = spawn("npx", ["vite", "--host", "127.0.0.1"], {
  stdio: "inherit",
  shell: true,
});

const electronEnv = {
  ...process.env,
  VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
};

function waitForVite() {
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(electronEnv.VITE_DEV_SERVER_URL, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => setTimeout(check, 250));
      req.setTimeout(500, () => {
        req.destroy();
        setTimeout(check, 250);
      });
    };
    check();
  });
}

await waitForVite();

const tsc = spawn("npx", ["tsc", "-p", "tsconfig.electron.json", "--watch", "--preserveWatchOutput"], {
  stdio: "inherit",
  shell: true,
});

await new Promise((resolve) => setTimeout(resolve, 1200));

spawn("node", ["scripts/copy-preload.mjs"], {
  stdio: "inherit",
  shell: true,
});

const electron = spawn("npx", ["electron", "dist/electron/main.js"], {
  stdio: "inherit",
  shell: true,
  env: electronEnv,
});

electron.on("exit", () => {
  vite.kill();
  tsc.kill();
  process.exit(0);
});
