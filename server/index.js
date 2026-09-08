// index.js — 服务端入口
// 单端口 Express：管理 API (/api/*) + HTTP 代理 (/*)

const ConfigManager = require('./config-manager');
const { validateAdminPassword, isWeakAdminPassword, MIN_ADMIN_PASSWORD_LENGTH } = require('./config-manager');
const createApp = require('./app');
const statsManager = require('./stats-manager');

// 监听地址：默认保持 0.0.0.0 以兼容既有部署；建议公网机器设为 127.0.0.1 并用反代只暴露 /v1/*
const HOST = process.env.HOST || '0.0.0.0';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

async function main() {
  console.log('LLMHydra - LLM Proxy with Automatic Failover');
  console.log('=============================================\n');

  const configManager = new ConfigManager();
  configManager.load();

  // 支持通过环境变量在启动时强制重置管理密码（用于替换弱口令，无需手改配置文件）
  const envPassword = process.env.ADMIN_PASSWORD;
  if (envPassword && envPassword !== configManager.getAdminPassword()) {
    const check = validateAdminPassword(envPassword);
    if (!check.ok) {
      console.error(`[FATAL] 环境变量 ADMIN_PASSWORD 不满足强度要求：${check.reason}`);
      process.exit(1);
    }
    configManager.setAdminPassword(envPassword);
    console.log('[安全] 已根据环境变量 ADMIN_PASSWORD 更新管理密码');
  }

  const config = configManager.getConfig();
  const port = config.port || 8093;
  const adminPassword = configManager.getAdminPassword();

  console.log(`配置加载完成: ${config.models.length} 个模型, ${config.groups.length} 个配置组`);

  // 提前初始化统计库：若线上目录不可写，会在控制台明确提示并使用备用位置
  statsManager.init();
  console.log(`统计库: ${statsManager._dbFile || '不可用（已降级，不影响代理）'}`);

  const app = createApp(configManager);

  const server = app.listen(port, HOST, () => {
    console.log(`\n已启动: http://localhost:${port}`);
    console.log(`  监听地址  : ${HOST}:${port}`);
    console.log(`  管理面板  : http://localhost:${port}`);
    console.log(`  管理密码  : ${adminPassword}`);
    console.log(`  代理密钥  : ${config.settings.proxy_key}`);
    console.log(`\n提示: 管理密码和代理密钥保存在 proxy_config.json 中\n`);

    // ---- 启动安全告警 ----
    const warnings = [];

    if (!LOOPBACK_HOSTS.has(HOST)) {
      warnings.push(
        `服务监听在 ${HOST}（非本地回环），管理面板可直接从公网访问。`,
        `  建议在前面加一层反向代理，只对外暴露 /v1/* 代理路径；`,
        `  或直接设置 HOST=127.0.0.1 再配合反代使用。`
      );
    }

    if (isWeakAdminPassword(adminPassword)) {
      warnings.push(
        `当前管理密码是弱口令，公网部署下极易被暴力破解（攻破即可拿到全部上游 API Key）。`,
        `  请立即更换为至少 ${MIN_ADMIN_PASSWORD_LENGTH} 位、含字母+数字或符号的强密码：`,
        `  方式一（推荐）：在管理面板「设置」中修改；`,
        `  方式二：启动时带环境变量 ADMIN_PASSWORD=<强密码> 运行一次即可写入配置。`
      );
    }

    if (warnings.length > 0) {
      console.log('┌──────────────────────────────────────────────────────────────┐');
      console.log('│  ⚠ 安全告警                                                   │');
      console.log('└──────────────────────────────────────────────────────────────┘');
      for (const line of warnings) {
        console.log(`  ${line}`);
      }
      console.log('');
    }
  });

  // 调大 Node 默认超时，适配 LLM 代理场景：
  // - 客户端 Agent 模式/多图请求体较大，给足上传时间
  // - headersTimeout 默认 60s，大请求体上传慢时会提前剪断连接（表现为客户端报不完整响应）
  // - 长流式响应期间也要保证连接不被服务端主动掐断
  server.headersTimeout = 5 * 60 * 1000;   // 等待完整请求头的上限
  server.requestTimeout = 10 * 60 * 1000;  // 单个请求总时限（含 body 上传 + 长流响应）
  server.keepAliveTimeout = 65 * 1000;      // 略大于常见反代的 60s，避免 keep-alive 连接被服务端先行关闭

  // 优雅退出：关闭统计库（触发 WAL checkpoint，避免最近明细停留在 -wal 文件里）
  const shutdown = () => {
    console.log('\n正在停止...');
    statsManager.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 兜底：未处理的 Promise 拒绝只记录日志，不崩进程（如代理链路中的意外异常）
  process.on('unhandledRejection', (reason) => {
    console.error('[ERROR] 未处理的 Promise 拒绝:', reason);
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
