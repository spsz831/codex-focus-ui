#!/usr/bin/env node

const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "cfu.ps1");

const command = process.platform === "win32" ? "powershell" : "pwsh";
const args = process.platform === "win32"
  ? ["-ExecutionPolicy", "Bypass", "-File", scriptPath, "ui"]
  : ["-File", scriptPath, "ui"];

const child = spawn(command, args, {
  cwd: repoRoot,
  stdio: "inherit",
  windowsHide: false
});

child.on("error", (err) => {
  console.error(`[cfu-ui] failed to start: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
