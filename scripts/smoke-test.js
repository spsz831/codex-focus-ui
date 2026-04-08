#!/usr/bin/env node

const { spawnSync, spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { getProjectMeta } = require("../packages/shared/src/config");

const ROOT = path.resolve(__dirname, "..");
const META = getProjectMeta(ROOT);

function assert(ok, message) {
  if (!ok) {
    throw new Error(message);
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("error", reject);
  });
}

async function run() {
  const doctor = spawnSync("node", ["apps/cli/src/index.js", "doctor"], { cwd: ROOT, encoding: "utf8", shell: true });
  assert(doctor.status === 0, `doctor failed: ${doctor.stdout}\n${doctor.stderr}`);

  const demo = spawnSync("node", ["apps/cli/src/index.js", "demo"], { cwd: ROOT, encoding: "utf8", shell: true });
  assert(demo.status === 0, `demo failed: ${demo.stdout}\n${demo.stderr}`);

  const proxySession = path.join(ROOT, ".tmp", "proxy-smoke.jsonl");
  fs.mkdirSync(path.dirname(proxySession), { recursive: true });
  if (fs.existsSync(proxySession)) fs.unlinkSync(proxySession);

  const proxy = spawnSync(
    "node",
    [
      "apps/cli/src/index.js",
      "proxy",
      "--session",
      proxySession,
      "--",
      "node",
      "-e",
      "process.stdout.write(process.argv[1])",
      "hello world"
    ],
    { cwd: ROOT, encoding: "utf8", shell: false }
  );
  assert(proxy.status === 0, `proxy failed: ${proxy.stdout}\n${proxy.stderr}`);
  assert(proxy.stdout.includes("hello world"), "proxy stdout missing spaced argument payload");
  assert(fs.existsSync(proxySession), "proxy session file missing");

  const proxyLines = fs.readFileSync(proxySession, "utf8").split(/\r?\n/).filter(Boolean);
  assert(proxyLines.length >= 1, "proxy session file empty");
  const proxyEntry = JSON.parse(proxyLines[proxyLines.length - 1]);
  assert(proxyEntry.command === 'node -e process.stdout.write(process.argv[1]) hello world', "proxy command capture mismatch");
  assert(proxyEntry.output.includes("hello world"), "proxy output capture mismatch");

  const viewer = spawn("node", ["apps/viewer/src/index.js"], { cwd: ROOT, stdio: "ignore", shell: true });
  await new Promise((r) => setTimeout(r, 1000));

  try {
    const home = await httpGet("http://127.0.0.1:3939/");
    assert(home.statusCode === 200, `viewer / status=${home.statusCode}`);
    assert(home.body.includes(`codex-focus-ui v${META.version}`), "viewer version marker missing");
    assert(home.body.includes("floating-last-question"), "floating bar missing");
    assert(home.body.includes("export-selected-markdown"), "selected export button missing");
    assert(home.body.includes("select-visible-btn"), "select visible button missing");
    assert(home.body.includes("clear-visible-btn"), "clear visible button missing");

    const api = await httpGet("http://127.0.0.1:3939/api/sessions");
    assert(api.statusCode === 200, `viewer /api/sessions status=${api.statusCode}`);
    assert(api.body.includes("sessions"), "sessions api payload invalid");

    const md = await httpGet("http://127.0.0.1:3939/export.md?mode=all&keyword=");
    assert(md.statusCode === 200, `viewer /export.md status=${md.statusCode}`);
    assert(md.body.includes("# codex-focus-ui 导出清单"), "markdown export invalid");
  } finally {
    if (!viewer.killed) viewer.kill("SIGTERM");
  }

  console.log("smoke_ok");
}

run().catch((err) => {
  console.error(`smoke_failed: ${err.message}`);
  process.exit(1);
});

