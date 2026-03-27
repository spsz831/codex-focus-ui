#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".data", "sessions");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function walkJsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.endsWith(".jsonl")) out.push(full);
    }
  }
  return out;
}

function toText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function readArg(name) {
  const key = `--${name}`;
  const i = process.argv.indexOf(key);
  if (i < 0 || i + 1 >= process.argv.length) return "";
  return String(process.argv[i + 1]).trim();
}

function localDayFromTs(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function getTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getLatestSessionIdFromHistory(codexHome) {
  const historyPath = path.join(codexHome, "history.jsonl");
  const items = readJsonl(historyPath);
  if (!items.length) return null;
  const last = items[items.length - 1];
  return last.session_id || null;
}

function findRolloutFile(codexHome, sessionId) {
  const sessionsDir = path.join(codexHome, "sessions");
  const files = walkJsonlFiles(sessionsDir);
  if (!files.length) return null;

  if (sessionId) {
    const exact = files.find((f) => f.includes(sessionId));
    if (exact) return exact;
  }

  files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  return files[files.length - 1];
}

function extractQaFromRollout(filePath, targetDay) {
  const rows = readJsonl(filePath);
  const out = [];

  for (const row of rows) {
    const ts = row.timestamp || new Date().toISOString();
    if (localDayFromTs(ts) !== targetDay) continue;
    if (row.type !== "event_msg" || !row.payload) continue;

    const p = row.payload;
    if (p.type === "user_message") {
      const text = toText(p.message);
      if (!text) continue;
      out.push({
        id: `${Date.now()}-${out.length + 1}`,
        type: "user",
        ts,
        source: "codex-live",
        text
      });
      continue;
    }

    if (p.type === "agent_message") {
      const text = toText(p.message);
      if (!text) continue;
      out.push({
        id: `${Date.now()}-${out.length + 1}`,
        type: "assistant",
        ts,
        source: "codex-live",
        text
      });
    }
  }

  return out;
}

function writeJsonl(filePath, items) {
  ensureDir(path.dirname(filePath));
  const body = items.map((x) => JSON.stringify(x)).join("\n");
  fs.writeFileSync(filePath, `${body}${body ? "\n" : ""}`, "utf8");
}

function main() {
  const targetDay = readArg("day") || getTodayLocal();
  const codexHome = path.join(os.homedir(), ".codex");
  const sessionId = getLatestSessionIdFromHistory(codexHome);
  const rollout = findRolloutFile(codexHome, sessionId);

  if (!rollout) {
    console.log("sync_codex_chat: no rollout file found");
    process.exit(0);
  }

  const items = extractQaFromRollout(rollout, targetDay);
  const dayFile = path.join(OUT_DIR, `codex-auto-${targetDay}.jsonl`);
  const currentFile = path.join(OUT_DIR, "codex-auto-current.jsonl");

  writeJsonl(dayFile, items);
  writeJsonl(currentFile, items);

  console.log(`sync_codex_chat: ok -> ${dayFile} (items=${items.length})`);
  console.log(`sync_codex_chat: current -> ${currentFile}`);
}

main();

