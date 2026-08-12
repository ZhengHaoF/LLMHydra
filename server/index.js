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

  console.log(`配置加载完成: ${config.models.length} 个模型`);
  if (config.models.length > 0) {
    console.log(`当前模型: ${config.models[config.selected_index]?.name || '无'}`);
  }

  const app = createApp(configManager);

  app.listen(port, '0.0.0.0', () => {
    console.log(`\n已启动: http://localhost:${port}`);
    console.log(`  管理 API  : /api/*`);
    console.log(`  AI 代理   : /*  → 上游模型`);
    console.log(`  管理面板  : http://localhost:5173\n`);
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
