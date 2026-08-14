// index.js — 服务端入口
// 单端口 Express：管理 API (/api/*) + HTTP 代理 (/*)

const ConfigManager = require('./config-manager');
const createApp = require('./app');

async function main() {
  console.log('LLMHydra - LLM Proxy with Automatic Failover');
  console.log('=============================================\n');

  const configManager = new ConfigManager();
  configManager.load();

  const config = configManager.getConfig();
  const port = config.port || 8093;
  const adminPassword = configManager.getAdminPassword();

  console.log(`配置加载完成: ${config.models.length} 个模型, ${config.groups.length} 个配置组`);

  const app = createApp(configManager);

  app.listen(port, '0.0.0.0', () => {
    console.log(`\n已启动: http://localhost:${port}`);
    console.log(`  管理面板  : http://localhost:${port}`);
    console.log(`  管理密码  : ${adminPassword}`);
    console.log(`  代理密钥  : ${config.settings.proxy_key}`);
    console.log(`\n提示: 管理密码和代理密钥保存在 proxy_config.json 中\n`);
  });

  // 优雅退出
  const shutdown = () => {
    console.log('\n正在停止...');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
