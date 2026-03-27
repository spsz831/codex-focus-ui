# codex-focus-ui

v0.1.0 是当前稳定收口版，目标是让你在 5-10 秒内定位上一轮提问，并减少无关输出干扰。

## Latest Release

- Version: `v0.1.0`
- Release: https://github.com/spsz831/codex-focus-ui/releases/tag/v0.1.0
- Status: Stable

### Highlights

- 默认折叠命令输出，保留关键过程摘要
- 一键定位上一问（按钮 + `J` 快捷键）
- `/` 快速聚焦搜索框
- 类型过滤：`全部 / 仅提问 / 仅回答 / 仅命令 / 仅书签`
- 关键词搜索（问题、回答、命令、输出）
- 会话书签（本地保存）
- 历史会话切换（按 `.jsonl` 文件）
- 悬浮上一问栏（定位 + 复制）
- 按当前筛选条件导出 Markdown 复盘清单

### Stability

- 配置文件：`codex-focus-ui.config.json`
- CLI 诊断命令：`npm run doctor`
- 最小冒烟测试：`npm run test:smoke`
- Viewer 请求异常兜底与错误提示

## v0.1.0 能力

- 命令输出默认折叠，顶部保留过程摘要。
- 历史会话切换（下拉选择 `.jsonl`）。
- 一键定位上一问（按钮 + `J`），`/` 快速聚焦搜索框。
- 类型过滤：`全部 / 仅提问 / 仅回答 / 仅命令 / 仅书签`。
- 关键词搜索（问题、回答、命令、输出）。
- 会话书签（本地保存）。
- 悬浮上一问栏（定位 + 复制）。
- 导出 Markdown（按当前筛选状态导出）。

## 稳定化新增

- 项目配置文件：`codex-focus-ui.config.json`
- CLI 自检：`npm run doctor`
- 最小冒烟测试：`npm run test:smoke`
- Viewer 请求异常提示（终端可见错误日志）

## 快速开始

```bash
cd E:\WorkCodex\codex-focus-ui
npm run doctor
npm run demo:capture
npm run proxy:codex-version
npm run dev:viewer
```

浏览器打开：`http://127.0.0.1:3939`

## 配置文件

`codex-focus-ui.config.json`：

```json
{
  "dataDir": ".data",
  "viewerPort": 3939,
  "cli": {
    "maxOutputChars": 200000
  }
}
```

## 常用命令

```bash
# 诊断
npm run doctor

# 生成演示数据
npm run demo:capture

# 代理真实命令并自动记录
node apps/cli/src/index.js proxy -- codex --version
node apps/cli/src/index.js proxy -- npm -v

# 启动 viewer
npm run dev:viewer

# 冒烟测试
npm run test:smoke
```
