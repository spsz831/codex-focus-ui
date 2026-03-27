#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVICE_DIR = path.join(ROOT, ".data", "service");
const PID_FILE = path.join(SERVICE_DIR, "runner.pid");
const STATUS_FILE = path.join(SERVICE_DIR, "status.json");
const LOG_FILE = path.join(SERVICE_DIR, "service.log");
const SYNC_INTERVAL_MS = 15000;

let viewer = null;
let timer = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${nowIso()}] ${message}`;
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`, "utf8");
  } catch {}
}

function isProcessRunning(pid) {
  if (!pid || Number.isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function readExistingPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const txt = String(fs.readFileSync(PID_FILE, "utf8") || "").trim();
  if (!txt) return null;
  return Number(txt);
}

function writeStatus(extra = {}) {
  const payload = {
    runnerPid: process.pid,
    viewerPid: viewer ? viewer.pid : null,
    startedAt: extra.startedAt || nowIso(),
    lastSyncAt: extra.lastSyncAt || null,
    state: extra.state || "running"
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function currentDay() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function runSync() {
  const day = currentDay();
  const r = spawnSync("node", ["scripts/sync-codex-chat.js", "--day", day], {
    cwd: ROOT,
    shell: true,
    encoding: "utf8"
  });

  if (r.status !== 0) {
    log(`sync failed: status=${r.status} stderr=${(r.stderr || "").trim()}`);
    return false;
  }

  writeStatus({ lastSyncAt: nowIso(), startedAt: startedAtIso, state: "running" });
  return true;
}

function startViewer() {
  viewer = spawn("node", ["apps/viewer/src/index.js"], {
    cwd: ROOT,
    shell: true,
    detached: false,
    windowsHide: true,
    stdio: "ignore"
  });

  viewer.on("exit", (code) => {
    log(`viewer exited code=${code}`);
    viewer = null;
  });
}

function cleanupAndExit(code) {
  if (timer) clearInterval(timer);
  if (viewer && isProcessRunning(viewer.pid)) {
    try { process.kill(viewer.pid, "SIGTERM"); } catch {}
  }
  try { fs.unlinkSync(PID_FILE); } catch {}
  try {
    writeStatus({ startedAt: startedAtIso, lastSyncAt: nowIso(), state: "stopped" });
  } catch {}
  process.exit(code);
}

ensureDir(SERVICE_DIR);

const existing = readExistingPid();
if (existing && isProcessRunning(existing)) {
  log(`service already running pid=${existing}`);
  process.exit(1);
}

const startedAtIso = nowIso();
fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
log(`service started pid=${process.pid}`);

runSync();
startViewer();
writeStatus({ startedAt: startedAtIso, lastSyncAt: nowIso(), state: "running" });

timer = setInterval(() => {
  runSync();
}, SYNC_INTERVAL_MS);

process.on("SIGINT", () => cleanupAndExit(0));
process.on("SIGTERM", () => cleanupAndExit(0));
process.on("uncaughtException", (err) => {
  log(`uncaughtException: ${err.message}`);
  cleanupAndExit(1);
});
