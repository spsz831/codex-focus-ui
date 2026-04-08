#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");

const { loadProjectConfig, getProjectMeta } = require("../../../packages/shared/src/config");

const ROOT = path.resolve(__dirname, "../../../");
const CONFIG = loadProjectConfig(ROOT);
const META = getProjectMeta(ROOT);
const DATA_DIR = path.resolve(ROOT, CONFIG.dataDir || ".data", "sessions");
const PORT = Number(process.env.CODEX_FOCUS_UI_PORT || CONFIG.viewerPort || 3939);

function listSessionFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
}

function isSafeSessionName(name) {
  return /^[a-zA-Z0-9._-]+\.jsonl$/.test(String(name || ""));
}

function resolveSessionPath(sessionName) {
  const names = listSessionFiles();
  if (!names.length) return null;

  if (sessionName && names.includes(sessionName)) {
    return path.join(DATA_DIR, sessionName);
  }

  return path.join(DATA_DIR, names[names.length - 1]);
}

function loadSessionByName(sessionName) {
  const sessionPath = resolveSessionPath(sessionName);
  if (!sessionPath) return { sessionPath: null, sessionName: null, entries: [], sessionNames: [] };

  const lines = fs.readFileSync(sessionPath, "utf8").split(/\r?\n/).filter(Boolean);
  const entries = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { type: "broken", text: line };
    }
  });

  return {
    sessionPath,
    sessionName: path.basename(sessionPath),
    entries,
    sessionNames: listSessionFiles()
  };
}

function deleteSessionByName(sessionName) {
  if (!isSafeSessionName(sessionName)) {
    return { ok: false, error: "invalid session name" };
  }

  const full = path.join(DATA_DIR, sessionName);
  if (!fs.existsSync(full)) {
    return { ok: false, error: "session not found" };
  }

  fs.unlinkSync(full);
  const remaining = listSessionFiles();
  const next = remaining.length ? remaining[remaining.length - 1] : "";
  return { ok: true, deleted: sessionName, next };
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(text) {
  const src = escapeHtml(text || "");
  const blocks = [];

  let output = src.replace(/```([\s\S]*?)```/g, (_, code) => {
    const token = `__CODE_BLOCK_${blocks.length}__`;
    blocks.push(`<pre><code>${code}</code></pre>`);
    return token;
  });

  output = output
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, "<br>");

  output = output.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => blocks[Number(idx)] || "");
  return output;
}

function makeSummary(entries) {
  const users = entries.filter((item) => item.type === "user").length;
  const commands = entries.filter((item) => item.type === "command");
  const failed = commands.filter((item) => Number(item.exitCode) !== 0).length;
  const assistants = entries.filter((item) => item.type === "assistant").length;
  const lastQuestion = [...entries].reverse().find((item) => item.type === "user");
  const recentCommands = [...commands].reverse().slice(0, 5).map((item) => ({
    command: item.command,
    exitCode: item.exitCode,
    durationMs: item.durationMs,
    source: item.source || "unknown"
  }));

  return {
    users,
    commands: commands.length,
    failed,
    assistants,
    lastQuestion: lastQuestion ? lastQuestion.text : "暂无",
    recentCommands
  };
}

function renderCommandDigest(recentCommands) {
  if (!recentCommands.length) return "<p>暂无命令过程。</p>";

  const items = recentCommands
    .map((item) => {
      const ok = Number(item.exitCode) === 0;
      const status = ok ? "✅" : "❌";
      const duration = item.durationMs ? `${item.durationMs}ms` : "-";
      return `<li><strong>${status}</strong> <code>${escapeHtml(item.command || "(empty)")}</code> <span class="dim">[${escapeHtml(item.source)} | ${duration}]</span></li>`;
    })
    .join("\n");

  return `<ul class="digest-list">${items}</ul>`;
}

function buildSearchText(item) {
  if (!item || typeof item !== "object") return "";
  const parts = [];
  if (item.type) parts.push(item.type);
  if (item.text) parts.push(item.text);
  if (item.command) parts.push(item.command);
  if (item.output) parts.push(item.output);
  if (item.ts) parts.push(item.ts);
  return parts.join(" ");
}

function filterEntriesForExport(entries, mode, keyword, bookmarksSet, selectedSet = new Set(), selectedOnly = false) {
  const kw = String(keyword || "").trim().toLowerCase();
  return entries.filter((item, idx) => {
    const type = item.type || "broken";
    const id = `entry-${idx}`;
    const search = buildSearchText(item).toLowerCase();
    const selectedHit = selectedSet.has(id);
    if (selectedOnly) return selectedHit;
    const modeHit = mode === "all" || type === mode || (mode === "bookmarked" && bookmarksSet.has(id));
    const keywordHit = !kw || search.includes(kw);
    return modeHit && keywordHit;
  });
}

function renderExportMarkdown(sessionPath, entries, mode, keyword, bookmarksCsv, selectedCsv, selectedOnly) {
  const bookmarksSet = new Set(String(bookmarksCsv || "").split(",").map((v) => v.trim()).filter(Boolean));
  const selectedSet = new Set(String(selectedCsv || "").split(",").map((v) => v.trim()).filter(Boolean));
  const filtered = filterEntriesForExport(entries, mode, keyword, bookmarksSet, selectedSet, Boolean(selectedOnly));
  const summary = makeSummary(filtered);
  const sessionName = sessionPath ? path.basename(sessionPath) : "no-session";

  const lines = [];
  lines.push(`# codex-focus-ui 导出清单`);
  lines.push("");
  lines.push(`- 会话文件: ${sessionName}`);
  lines.push(`- 导出时间: ${new Date().toISOString()}`);
  lines.push(`- 过滤模式: ${mode}`);
  lines.push(`- 关键词: ${keyword || "(无)"}`);
  lines.push(`- 条目数量: ${filtered.length}`);
  lines.push(`- 摘要: 提问 ${summary.users} / 回答 ${summary.assistants} / 命令 ${summary.commands} (失败 ${summary.failed})`);
  lines.push("");

  filtered.forEach((item, idx) => {
    const no = idx + 1;
    if (item.type === "user") {
      lines.push(`## ${no}. 提问`);
      lines.push("");
      lines.push(`- 时间: ${item.ts || ""}`);
      lines.push(`- 内容:`);
      lines.push("```markdown");
      lines.push(String(item.text || ""));
      lines.push("```");
      lines.push("");
      return;
    }

    if (item.type === "assistant") {
      lines.push(`## ${no}. 回答`);
      lines.push("");
      lines.push(`- 时间: ${item.ts || ""}`);
      lines.push(`- 内容:`);
      lines.push("```markdown");
      lines.push(String(item.text || ""));
      lines.push("```");
      lines.push("");
      return;
    }

    if (item.type === "command") {
      lines.push(`## ${no}. 命令`);
      lines.push("");
      lines.push(`- 时间: ${item.ts || ""}`);
      lines.push(`- 命令: \`${item.command || ""}\``);
      lines.push(`- 结果: ${Number(item.exitCode) === 0 ? "成功" : "失败"} (exitCode=${item.exitCode})`);
      lines.push(`- 来源: ${item.source || "unknown"}`);
      lines.push(`- 耗时: ${item.durationMs || "-"}ms`);
      lines.push("- 输出:");
      lines.push("```text");
      lines.push(String(item.output || "").slice(0, 4000));
      lines.push("```");
      lines.push("");
      return;
    }

    lines.push(`## ${no}. 其他`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(item, null, 2));
    lines.push("```");
    lines.push("");
  });

  return lines.join("\n");
}

function renderSessionOptions(sessionNames, currentSessionName) {
  if (!sessionNames.length) return '<option value="">(暂无会话)</option>';
  return sessionNames
    .map((name) => `<option value="${escapeHtml(name)}" ${name === currentSessionName ? "selected" : ""}>${escapeHtml(name)}</option>`)
    .join("\n");
}

function renderEntry(item, index, lastUserIndex) {
  const isLastUser = item.type === "user" && index === lastUserIndex;
  const anchorId = isLastUser ? ' id="last-user-question"' : "";
  const extraClass = isLastUser ? " last-user-question" : "";
  const searchable = escapeHtml(buildSearchText(item)).toLowerCase();

  const title = item.type === "user"
    ? "你的提问"
    : item.type === "assistant"
      ? "助手回答"
      : item.type === "command"
        ? "命令过程"
        : "未识别记录";

  const headerMeta = item.type === "command"
    ? (() => {
        const status = Number(item.exitCode) === 0 ? "success" : "failed";
        const statusLabel = status === "success" ? "✅ 成功" : "❌ 失败";
        return `<span class="status ${status}">${statusLabel}</span>`;
      })()
    : "";

  const body = item.type === "user"
    ? `<div class="md-content">${renderMarkdown(item.text)}</div><small>${escapeHtml(item.ts)}</small>`
    : item.type === "assistant"
      ? `<div class="md-content">${renderMarkdown(item.text)}</div><small>${escapeHtml(item.ts)}</small>`
      : item.type === "command"
        ? `<p><code>${escapeHtml(item.command)}</code></p><p class="dim">来源: ${escapeHtml(item.source || "unknown")} | 耗时: ${escapeHtml(item.durationMs || "-")}ms</p><details><summary>查看命令输出（默认折叠）</summary><pre>${escapeHtml(item.output || "(无输出)")}</pre></details><small>${escapeHtml(item.ts)}</small>`
        : `<pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre>`;

  const type = item.type || "broken";
  return `<article${anchorId} data-id="entry-${index}" data-type="${type}" data-search="${searchable}" class="card ${type}${extraClass}"><div class="card-topline"><label class="select-toggle"><input type="checkbox" data-select-toggle="entry-${index}" /> 勾选</label><div class="card-heading"><h3>${title}</h3>${headerMeta}</div><button class="bookmark-btn" type="button" data-bookmark-toggle="entry-${index}">☆ 书签</button></div>${body}</article>`;
}

function renderPage(sessionPath, sessionName, sessionNames, entries) {
  const summary = makeSummary(entries);
  let lastUserIndex = -1;
  entries.forEach((item, idx) => {
    if (item.type === "user") lastUserIndex = idx;
  });

  const cards = entries.map((entry, idx) => renderEntry(entry, idx, lastUserIndex)).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>codex-focus-ui viewer v${escapeHtml(META.version)}</title>
  <style>
    .warning { margin: 8px 0 12px; padding: 10px 12px; border-radius: 10px; border: 1px solid #5a3b2d; background: #2a1a14; color: #ffd8c8; }
    body { margin: 0; padding: 24px; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0b0b0b; color: #f3f3f3; }
    .wrap { max-width: 980px; margin: 0 auto 120px; }
    .title { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .hotkeys { color: #9ba4aa; margin-bottom: 12px; font-size: 13px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; align-items: center; }
    .btn { border: 1px solid #2f6d88; background: #13212b; color: #8edfff; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
    .btn.alt { border-color: #3a3a3a; background: #1a1a1a; color: #d0d0d0; }
    .btn.danger { border-color: #7a3a3a; background: #2a1212; color: #ffb7b7; }
    .btn.active { border-color: #69d6ff; color: #d4f2ff; box-shadow: inset 0 0 0 1px rgba(105, 214, 255, 0.3); }
    .input, .select { border: 1px solid #3a3a3a; background: #141414; color: #f2f2f2; border-radius: 8px; padding: 8px 10px; min-width: 220px; }
    .summary { background: #171717; border: 1px solid #2b2b2b; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .summary p { margin: 6px 0; color: #d2d2d2; }
    .last-q { color: #6fd3ff; font-weight: 700; }
    .digest { margin-top: 10px; background: #111; border: 1px solid #303030; border-radius: 10px; padding: 10px; }
    .digest-title { font-size: 13px; margin-bottom: 8px; color: #cfd9df; }
    .digest-list { margin: 0; padding-left: 18px; }
    .digest-list li { margin: 5px 0; }
    .list { display: grid; gap: 12px; }
    .card { position: relative; background: #151515; border: 1px solid #2d2d2d; border-radius: 12px; padding: 14px; }
    .card-topline { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .card-heading { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
    .bookmark-btn { border: 1px solid #454545; background: #1f1f1f; color: #dadada; border-radius: 999px; padding: 2px 8px; cursor: pointer; font-size: 12px; margin-left: auto; flex-shrink: 0; }
    .select-toggle { font-size: 12px; color: #cfcfcf; display: inline-flex; gap: 6px; align-items: center; user-select: none; white-space: nowrap; flex-shrink: 0; }
    .selected { border-color: #4f9b5d; box-shadow: inset 0 0 0 1px rgba(112, 211, 132, 0.35); }
    .bookmark-btn.active { border-color: #dcb95a; color: #ffd877; background: #2a2410; }
    .card h3 { margin: 0; font-size: 16px; }
    .card p { margin: 0 0 8px 0; line-height: 1.5; }
    .card small { color: #9a9a9a; }
    .md-content { line-height: 1.65; margin-bottom: 8px; color: #e7e7e7; }
    .md-content pre { background: #101010; border: 1px solid #303030; border-radius: 8px; padding: 10px; white-space: pre-wrap; word-break: break-word; }
    .md-content a { color: #7fd7ff; text-decoration: underline; }
    .dim { color: #a0a0a0; }
    .user { border-color: #2f6d88; box-shadow: inset 0 0 0 1px rgba(111, 211, 255, 0.25); }
    .assistant { border-color: #434343; }
    .command { border-color: #4b4b4b; }
    .status { font-size: 12px; border-radius: 999px; padding: 2px 8px; margin-left: 8px; }
    .status.success { background: rgba(72, 193, 117, 0.2); color: #6be28f; }
    .status.failed { background: rgba(221, 83, 83, 0.2); color: #ff8d8d; }
    .last-user-question { border-color: #69d6ff; box-shadow: inset 0 0 0 1px rgba(105, 214, 255, 0.55), 0 0 0 1px rgba(105, 214, 255, 0.15); }
    .bookmarked { border-color: #7b6730; box-shadow: inset 0 0 0 1px rgba(220, 185, 90, 0.35); }
    .floating-last-question { position: fixed; left: 16px; right: 16px; bottom: 12px; z-index: 999; background: rgba(17, 17, 17, 0.96); border: 1px solid #2f6d88; border-radius: 12px; padding: 10px 12px; display: flex; gap: 10px; align-items: center; }
    .floating-scroll-nav { position: fixed; right: 16px; bottom: 84px; z-index: 1000; display: flex; gap: 8px; }
    .floating-scroll-nav .mini-btn { border: 1px solid #3f3f3f; background: rgba(22, 22, 22, 0.95); color: #d8d8d8; border-radius: 8px; padding: 7px 10px; cursor: pointer; }
    .floating-last-question .label { color: #9fdfff; font-size: 12px; }
    .floating-last-question .text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #eaf7ff; }
    .floating-last-question .mini-btn { border: 1px solid #3f3f3f; background: #1b1b1b; color: #d8d8d8; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    code { background: #232323; padding: 2px 6px; border-radius: 6px; }
    details { background: #111; border: 1px solid #303030; border-radius: 8px; padding: 8px; }
    summary { cursor: pointer; }
    pre { white-space: pre-wrap; word-break: break-word; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="title">codex-focus-ui v${escapeHtml(META.version)}</section>
    ${CONFIG._configError ? `<section class="warning">配置文件异常：${escapeHtml(CONFIG._configError)}，当前已回退默认配置。</section>` : ""}
    <section class="hotkeys">快捷键：<code>J</code> 定位上一轮提问，<code>/</code> 聚焦搜索框，<code>T</code>/<code>B</code> 快速到顶部/底部。</section>
    <section class="toolbar">
      <label class="dim" for="session-select">会话:</label>
      <select id="session-select" class="select">${renderSessionOptions(sessionNames, sessionName)}</select>
      <button id="session-delete" class="btn danger" title="删除当前会话文件">删除会话</button>
      <button id="jump-last-question" class="btn">定位上一轮提问</button>
      <button data-mode="all" class="btn alt mode-btn active">全部</button>
      <button data-mode="user" class="btn alt mode-btn">仅提问</button>
      <button data-mode="assistant" class="btn alt mode-btn">仅回答</button>
      <button data-mode="command" class="btn alt mode-btn">仅命令</button>
      <button data-mode="bookmarked" class="btn alt mode-btn">仅书签</button>
      <input id="keyword-input" class="input" type="text" placeholder="搜索关键词（命令/问题/回答）" />
      <button id="clear-search" class="btn alt">清空搜索</button>
      <button id="export-markdown" class="btn">导出 Markdown</button>
      <button id="export-selected-markdown" class="btn alt">导出勾选</button>
      <button id="select-visible-btn" class="btn alt">全选当前可见</button>
      <button id="clear-visible-btn" class="btn alt">取消全选当前可见</button>
    </section>
    <section class="summary">
      <p><strong>当前会话：</strong> ${escapeHtml(sessionPath || "未找到会话文件")}</p>
      <p><strong>过程摘要：</strong>提问 ${summary.users} 次，助手响应 ${summary.assistants} 次，命令 ${summary.commands} 次（失败 ${summary.failed} 次）。</p>
      <p class="last-q"><strong>上一轮提问：</strong>${escapeHtml(summary.lastQuestion)}</p>
      <div class="digest">
        <div class="digest-title">最近命令过程（折叠输出前先看这里）</div>
        ${renderCommandDigest(summary.recentCommands)}
      </div>
    </section>
    <section id="entry-list" class="list">${cards || '<article class="card">暂无会话数据，请先运行 capture/demo/proxy。</article>'}</section>
  </main>

  <section class="floating-scroll-nav" aria-label="页面快速滚动">
    <button id="scroll-top" class="mini-btn" type="button">到顶部</button>
    <button id="scroll-bottom" class="mini-btn" type="button">到底部</button>
  </section>

  <section id="floating-last-question" class="floating-last-question">
    <span class="label">上一问</span>
    <span id="floating-last-question-text" class="text">${escapeHtml(summary.lastQuestion)}</span>
    <button id="floating-jump" class="mini-btn" type="button">定位</button>
    <button id="floating-copy" class="mini-btn" type="button">复制</button>
  </section>

  <script>
    (() => {
      const jumpBtn = document.getElementById('jump-last-question');
      const deleteBtn = document.getElementById('session-delete');
      const scrollTopBtn = document.getElementById('scroll-top');
      const scrollBottomBtn = document.getElementById('scroll-bottom');
      const modeBtns = Array.from(document.querySelectorAll('.mode-btn'));
      const keywordInput = document.getElementById('keyword-input');
      const clearSearchBtn = document.getElementById('clear-search');
      const exportBtn = document.getElementById('export-markdown');
      const exportSelectedBtn = document.getElementById('export-selected-markdown');
      const selectVisibleBtn = document.getElementById('select-visible-btn');
      const clearVisibleBtn = document.getElementById('clear-visible-btn');
      const sessionSelect = document.getElementById('session-select');
      const floatingJumpBtn = document.getElementById('floating-jump');
      const floatingCopyBtn = document.getElementById('floating-copy');
      const list = document.getElementById('entry-list');
      const sessionPath = ${JSON.stringify(sessionPath || 'no-session')};
      const lastQuestionText = ${JSON.stringify(summary.lastQuestion || "")};
      const bookmarkStorageKey = 'codex-focus-ui:bookmarks:' + sessionPath;
      const selectedStorageKey = 'codex-focus-ui:selected:' + sessionPath;

      let mode = 'all';
      let keyword = '';
      const bookmarks = new Set(JSON.parse(localStorage.getItem(bookmarkStorageKey) || '[]'));
      const selected = new Set(JSON.parse(localStorage.getItem(selectedStorageKey) || '[]'));

      const saveBookmarks = () => {
        localStorage.setItem(bookmarkStorageKey, JSON.stringify(Array.from(bookmarks)));
      };

      const saveSelected = () => {
        localStorage.setItem(selectedStorageKey, JSON.stringify(Array.from(selected)));
      };

      const syncBookmarkUI = () => {
        const cards = list.querySelectorAll('[data-id]');
        cards.forEach((card) => {
          const id = card.getAttribute('data-id');
          const marked = bookmarks.has(id);
          card.classList.toggle('bookmarked', marked);
          const btn = card.querySelector('[data-bookmark-toggle]');
          if (btn) {
            btn.classList.toggle('active', marked);
            btn.textContent = marked ? '★ 书签' : '☆ 书签';
          }
        });
      };

      const syncSelectedUI = () => {
        const cards = list.querySelectorAll('[data-id]');
        cards.forEach((card) => {
          const id = card.getAttribute('data-id');
          const marked = selected.has(id);
          card.classList.toggle('selected', marked);
          const box = card.querySelector('[data-select-toggle]');
          if (box) box.checked = marked;
        });
      };

      const getVisibleEntryIds = () => {
        return Array.from(list.querySelectorAll('[data-id]'))
          .filter((card) => !card.classList.contains('hidden'))
          .map((card) => card.getAttribute('data-id'))
          .filter(Boolean);
      };

      const applyFilter = () => {
        const cards = list.querySelectorAll('[data-type]');
        cards.forEach((card) => {
          const type = card.getAttribute('data-type');
          const id = card.getAttribute('data-id');
          const search = (card.getAttribute('data-search') || '').toLowerCase();
          const modeHit = mode === 'all' || type === mode || (mode === 'bookmarked' && bookmarks.has(id));
          const keywordHit = !keyword || search.includes(keyword);
          card.classList.toggle('hidden', !(modeHit && keywordHit));
        });

        modeBtns.forEach((btn) => {
          const isActive = btn.getAttribute('data-mode') === mode;
          btn.classList.toggle('active', isActive);
        });
      };

      const jumpLastQuestion = () => {
        const target = document.getElementById('last-user-question');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };

      const copyLastQuestion = async () => {
        const text = String(lastQuestionText || '').trim();
        if (!text) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            floatingCopyBtn.textContent = '已复制';
            setTimeout(() => { floatingCopyBtn.textContent = '复制'; }, 1200);
            return;
          }
        } catch (_) {}

        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        floatingCopyBtn.textContent = '已复制';
        setTimeout(() => { floatingCopyBtn.textContent = '复制'; }, 1200);
      };

      jumpBtn?.addEventListener('click', jumpLastQuestion);
      scrollTopBtn?.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      scrollBottomBtn?.addEventListener('click', () => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); });
      floatingJumpBtn?.addEventListener('click', jumpLastQuestion);
      floatingCopyBtn?.addEventListener('click', copyLastQuestion);

      modeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          mode = btn.getAttribute('data-mode') || 'all';
          applyFilter();
        });
      });

      keywordInput?.addEventListener('input', (e) => {
        keyword = String(e.target.value || '').trim().toLowerCase();
        applyFilter();
      });

      clearSearchBtn?.addEventListener('click', () => {
        keyword = '';
        if (keywordInput) keywordInput.value = '';
        applyFilter();
      });

      exportBtn?.addEventListener('click', () => {
        const params = new URLSearchParams({
          mode,
          keyword,
          bookmarks: Array.from(bookmarks).join(',')
        });
        if (sessionSelect?.value) params.set('session', sessionSelect.value);
        window.location.href = '/export.md?' + params.toString();
      });

      exportSelectedBtn?.addEventListener('click', () => {
        if (!selected.size) {
          alert('请先勾选至少一条记录再导出。');
          return;
        }
        const params = new URLSearchParams({
          mode,
          keyword,
          bookmarks: Array.from(bookmarks).join(','),
          selected: Array.from(selected).join(','),
          selectedOnly: '1'
        });
        if (sessionSelect?.value) params.set('session', sessionSelect.value);
        window.location.href = '/export.md?' + params.toString();
      });

      selectVisibleBtn?.addEventListener('click', () => {
        getVisibleEntryIds().forEach((id) => selected.add(id));
        saveSelected();
        syncSelectedUI();
      });

      clearVisibleBtn?.addEventListener('click', () => {
        getVisibleEntryIds().forEach((id) => selected.delete(id));
        saveSelected();
        syncSelectedUI();
      });

      deleteBtn?.addEventListener('click', async () => {
        const target = sessionSelect?.value || '';
        if (!target) return;
        const ok = confirm('确认删除会话文件：' + target + ' ？');
        if (!ok) return;

        try {
          const r = await fetch('/api/session/delete?name=' + encodeURIComponent(target));
          const j = await r.json();
          if (!j.ok) {
            alert('删除失败: ' + (j.error || 'unknown'));
            return;
          }
          const params = new URLSearchParams(window.location.search);
          if (j.next) params.set('session', j.next);
          else params.delete('session');
          window.location.href = '/?' + params.toString();
        } catch (err) {
          alert('删除失败: ' + err.message);
        }
      });

      sessionSelect?.addEventListener('change', () => {
        const v = sessionSelect.value;
        const params = new URLSearchParams(window.location.search);
        if (v) params.set('session', v);
        else params.delete('session');
        window.location.href = '/?' + params.toString();
      });

      list.querySelectorAll('[data-bookmark-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-bookmark-toggle');
          if (!id) return;
          if (bookmarks.has(id)) bookmarks.delete(id);
          else bookmarks.add(id);
          saveBookmarks();
          syncBookmarkUI();
          applyFilter();
        });
      });

      list.querySelectorAll('[data-select-toggle]').forEach((box) => {
        box.addEventListener('change', () => {
          const id = box.getAttribute('data-select-toggle');
          if (!id) return;
          if (box.checked) selected.add(id);
          else selected.delete(id);
          saveSelected();
          syncSelectedUI();
        });
      });

      document.addEventListener('keydown', (e) => {
        const targetTag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        const typing = targetTag === 'input' || targetTag === 'textarea';

        if (!typing && e.key.toLowerCase() === 'j') {
          e.preventDefault();
          jumpLastQuestion();
          return;
        }
        if (!typing && e.key.toLowerCase() === 't') {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (!typing && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          return;
        }
        if (!typing && e.key === '/') {
          e.preventDefault();
          keywordInput?.focus();
        }
      });

      syncBookmarkUI();
      syncSelectedUI();
      applyFilter();
    })();
  </script>
</body>
</html>`;
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const sessionParam = url.searchParams.get("session") || "";
      const payload = loadSessionByName(sessionParam);

      if (url.pathname === "/") {
        const html = renderPage(payload.sessionPath, payload.sessionName, payload.sessionNames, payload.entries);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (url.pathname === "/export.md") {
        const mode = url.searchParams.get("mode") || "all";
        const keyword = url.searchParams.get("keyword") || "";
        const bookmarks = url.searchParams.get("bookmarks") || "";
        const selected = url.searchParams.get("selected") || "";
        const selectedOnly = url.searchParams.get("selectedOnly") === "1";
        const md = renderExportMarkdown(payload.sessionPath, payload.entries, mode, keyword, bookmarks, selected, selectedOnly);
        res.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": "attachment; filename=codex-focus-export.md"
        });
        res.end(md);
        return;
      }

      if (url.pathname === "/api/sessions") {
        const data = {
          sessions: payload.sessionNames,
          current: payload.sessionName
        };
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
        return;
      }

      if (url.pathname === "/api/session/delete") {
        const name = url.searchParams.get("name") || "";
        const result = deleteSessionByName(name);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    } catch (err) {
      console.error(`[codex-focus-ui viewer] request failed: ${err.message}`);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Viewer internal error. Check terminal logs.");
    }
  });

  server.listen(PORT, () => {
    console.log(`[codex-focus-ui viewer] v${META.version} running at http://127.0.0.1:${PORT}`);
    console.log("默认行为：命令输出折叠，支持悬浮上一问、会话切换、过滤、搜索、书签、Markdown 导出、会话删除。");
  });
}

startServer();











