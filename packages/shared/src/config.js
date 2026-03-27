const fs = require("fs");
const path = require("path");

function loadProjectConfig(rootDir) {
  const defaultConfig = {
    dataDir: ".data",
    viewerPort: 3939,
    cli: {
      maxOutputChars: 200000
    }
  };

  const configPath = path.join(rootDir, "codex-focus-ui.config.json");
  if (!fs.existsSync(configPath)) return defaultConfig;

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      ...defaultConfig,
      ...parsed,
      cli: {
        ...defaultConfig.cli,
        ...(parsed.cli || {})
      }
    };
  } catch (err) {
    return {
      ...defaultConfig,
      _configError: `配置文件解析失败: ${err.message}`
    };
  }
}

module.exports = {
  loadProjectConfig
};
