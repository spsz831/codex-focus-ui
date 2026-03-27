#!/usr/bin/env node

const { spawnSync, spawn } = require("child_process");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

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

  const viewer = spawn("node", ["apps/viewer/src/index.js"], { cwd: ROOT, stdio: "ignore", shell: true });
  await new Promise((r) => setTimeout(r, 1000));

  try {
    const home = await httpGet("http://127.0.0.1:3939/");
    assert(home.statusCode === 200, `viewer / status=${home.statusCode}`);
    assert(home.body.includes("codex-focus-ui v0.1.0"), "viewer version marker missing");
    assert(home.body.includes("floating-last-question"), "floating bar missing");

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
