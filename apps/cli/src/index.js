#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { loadProjectConfig, getProjectMeta } = require("../../../packages/shared/src/config");

const ROOT = path.resolve(__dirname, "../../../");
const CONFIG = loadProjectConfig(ROOT);
const META = getProjectMeta(ROOT);
const DATA_DIR = path.resolve(ROOT, CONFIG.dataDir || ".data", "sessions");
const MAX_OUTPUT = Number((CONFIG.cli && CONFIG.cli.maxOutputChars) || 200000);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

function readArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--") && token !== "--") {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(token);
    }
  }
  return out;
}

function redact(text) {
  if (!text) return text;
  return String(text)
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_PAT]")
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED_GOOGLE_API_KEY]");
}

function parseSessionPath(args) {
  if (args.session) return path.resolve(args.session);
  const date = new Date().toISOString().slice(0, 10);
  return path.join(DATA_DIR, `${date}.jsonl`);
}

function appendJsonlLine(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function commandCapture(args) {
  if (!args.q && !args.a && !args.cmd) {
    console.error("capture 模式至少需要 --q / --a / --cmd 之一。");
    process.exit(1);
  }

  const sessionPath = parseSessionPath(args);
  const requestId = `${Date.now()}`;

  if (args.q) {
    appendJsonlLine(sessionPath, {
      id: requestId,
      type: "user",
      ts: timestamp(),
      text: redact(args.q)
    });
  }

  if (args.a) {
    appendJsonlLine(sessionPath, {
      id: requestId,
      type: "assistant",
      ts: timestamp(),
      text: redact(args.a)
    });
  }

  if (args.cmd) {
    appendJsonlLine(sessionPath, {
      id: requestId,
      type: "command",
      ts: timestamp(),
      source: "manual-capture",
      command: args.cmd,
      exitCode: args.exitCode ? Number(args.exitCode) : 0,
      output: redact(args.output || "")
    });
  }

  console.log(`[codex-focus-ui cli] captured -> ${sessionPath}`);
}

function commandDemo(args) {
  const sessionPath = parseSessionPath(args);
  appendJsonlLine(sessionPath, {
    id: `${Date.now()}-1`,
    type: "user",
    ts: timestamp(),
    text: "帮我检查 npm EPERM 并验证 fetch MCP。"
  });
  appendJsonlLine(sessionPath, {
    id: `${Date.now()}-2`,
    type: "command",
    ts: timestamp(),
    source: "demo",
    command: "npm config get cache",
    exitCode: 0,
    durationMs: 92,
    output: "E:\\npm-cache-stable"
  });
  appendJsonlLine(sessionPath, {
    id: `${Date.now()}-3`,
    type: "assistant",
    ts: timestamp(),
    text: "已完成缓存路径检查，下一步建议验证 fetch MCP 连通性。"
  });
  console.log(`[codex-focus-ui cli] demo session generated -> ${sessionPath}`);
}

function parseProxyCommand(rawArgs) {
  const dashIndex = rawArgs.indexOf("--");
  if (dashIndex < 0) return [];
  return rawArgs.slice(dashIndex + 1);
}

function runProxy(rawArgs, parsedArgs) {
  const commandParts = parseProxyCommand(rawArgs);
  if (commandParts.length === 0) {
    console.error("proxy 用法: node apps/cli/src/index.js proxy -- <command> [args...]");
    process.exit(1);
  }

  const sessionPath = parseSessionPath(parsedArgs);
  const reqId = `${Date.now()}`;
  const startedAt = Date.now();
  const command = commandParts[0];
  const commandArgs = commandParts.slice(1);
  const commandString = commandParts.join(" ");
  let output = "";

  const child = spawn(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: false
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (output.length < MAX_OUTPUT) output += text;
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    if (output.length < MAX_OUTPUT) output += text;
  });

  child.on("error", (err) => {
    const message = `spawn error: ${err.message}`;
    console.error(`[codex-focus-ui cli] ${message}`);
    appendJsonlLine(sessionPath, {
      id: reqId,
      type: "command",
      ts: timestamp(),
      source: "proxy",
      command: commandString,
      exitCode: -1,
      durationMs: Date.now() - startedAt,
      output: redact(message)
    });
    process.exit(1);
  });

  child.on("close", (code) => {
    appendJsonlLine(sessionPath, {
      id: reqId,
      type: "command",
      ts: timestamp(),
      source: "proxy",
      command: commandString,
      exitCode: Number.isInteger(code) ? code : 1,
      durationMs: Date.now() - startedAt,
      output: redact(output)
    });
    console.log(`\n[codex-focus-ui cli] proxy captured -> ${sessionPath}`);
    process.exit(Number.isInteger(code) ? code : 1);
  });
}

function commandDoctor() {
  console.log(`codex-focus-ui doctor v${META.version}`);
  console.log(`- root: ${ROOT}`);
  console.log(`- dataDir: ${DATA_DIR}`);
  console.log(`- maxOutputChars: ${MAX_OUTPUT}`);

  if (CONFIG._configError) {
    console.log(`- config: ERROR ${CONFIG._configError}`);
    process.exitCode = 1;
  } else {
    console.log("- config: OK");
  }

  try {
    ensureDir(DATA_DIR);
    console.log("- sessions dir: OK");
  } catch (err) {
    console.log(`- sessions dir: ERROR ${err.message}`);
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`codex-focus-ui cli v${META.version}`);
  console.log("");
  console.log("Usage:");
  console.log("  node apps/cli/src/index.js capture --q <text> --a <text> --cmd <command> --output <stdout>");
  console.log("  node apps/cli/src/index.js demo [--session <path>]");
  console.log("  node apps/cli/src/index.js proxy -- <command> [args...]");
  console.log("  node apps/cli/src/index.js doctor");
}

function main() {
  const raw = process.argv.slice(2);
  const args = readArgs(raw);
  const command = args._[0];

  if (!command || command === "help" || args.help) {
    printHelp();
    return;
  }

  if (command === "capture") return commandCapture(args);
  if (command === "demo") return commandDemo(args);
  if (command === "proxy") return runProxy(raw, args);
  if (command === "doctor") return commandDoctor();

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main();
