# codex-focus-ui

面向 Codex CLI 的聚焦会话面板。目标是让你在 5-10 秒内定位上一轮提问、查看关键命令过程，并减少无关输出干扰。

## 30 秒启动

```bash
git clone https://github.com/spsz831/codex-focus-ui.git
cd codex-focus-ui
npm install
npm run ui
```

默认浏览器地址：

`http://127.0.0.1:3939`

如果你修改了 `codex-focus-ui.config.json` 中的 `viewerPort`，控制脚本和页面地址会自动跟随。

## 核心能力

- 默认折叠命令输出，优先显示过程摘要
- 一键定位上一问
- 类型过滤：全部 / 提问 / 回答 / 命令 / 书签
- 关键词搜索（问题、回答、命令、输出）
- 本地书签与历史会话切换
- Markdown 导出
- 导出勾选条目
- 全选当前可见 / 取消全选当前可见
- 本地控制面板与后台服务开关

## 项目结构

- `apps/cli`：会话采集、命令代理、诊断入口
- `apps/viewer`：本地 HTTP viewer
- `packages/shared`：共享配置读取
- `scripts`：PowerShell 控制脚本、烟测、自定义工具
- `.data`：本地运行数据（默认忽略，不提交）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 运行诊断

```bash
npm run doctor
```

### 3. 生成演示数据

```bash
npm run demo:capture
```

### 4. 启动 UI

```bash
npm run ui
```

## 配置文件

配置文件是：

`codex-focus-ui.config.json`

默认内容：

```json
{
  "dataDir": ".data",
  "viewerPort": 3939,
  "cli": {
    "maxOutputChars": 200000
  }
}
```

含义：

- `dataDir`：本地数据目录
- `viewerPort`：viewer 端口
- `cli.maxOutputChars`：命令输出最大保留长度

此外也支持环境变量：

- `CODEX_FOCUS_UI_PORT`

如果设置该环境变量，会优先覆盖配置文件中的端口。

## 常用命令

```bash
# 一键打开 UI（确保服务运行并打开页面）
npm run ui

# 打开控制面板菜单
npm run ui:menu

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

## 运行方式说明

### `npm run ui`

适合日常使用。会确保后台服务运行，并自动打开页面。

### `npm run ui:menu`

适合需要手动控制服务状态时使用。可查看状态、启动、停止、打开页面。

### `node apps/cli/src/index.js proxy -- <command>`

适合把真实命令执行过程采集进会话文件。

## 发布建议

发布前至少做这几步：

```bash
npm run doctor
npm run test:smoke
```

然后：

```bash
git add .
git commit -m "your message"
git tag vX.Y.Z
git push origin master --tags
```

版本说明写在：

- `CHANGELOG.md`
- GitHub Releases

## 当前状态

- 本地配置读取正常
- viewer 端口已统一从配置读取
- `proxy` 参数执行已修正，不再把命令和参数拼成单一字符串
- `smoke-test` 可作为最小回归验证

## License

MIT
