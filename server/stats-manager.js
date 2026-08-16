// stats-manager.js — SQLite 统计持久化
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB_FILE = path.join(__dirname, '..', 'stats.db');

// 自动保留天数：超过该天数的请求明细在启动后首次访问时清理，避免 stats.db 无限增长
const RETENTION_DAYS = 90;

class StatsManager {
  constructor() {
    this.db = null;
    this._dbFile = null;
    this._initFailed = false;
  }

  // 打开统计库。默认使用应用根目录的 stats.db；
  // 若不可写（如线上只读目录 / 文件系统不支持 WAL），回退到系统临时目录，保证统计可用。
  // 可用环境变量 STATS_DB_PATH 指定固定位置（如 PaaS 可写卷）。
  init() {
    if (this.db || this._initFailed) return;

    const candidates = [];
    if (process.env.STATS_DB_PATH) candidates.push(path.resolve(process.env.STATS_DB_PATH));
    candidates.push(DB_FILE);
    candidates.push(path.join(os.tmpdir(), 'llmhydra-stats.db'));

    for (const file of candidates) {
      try {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const db = new Database(file);
        try {
          db.pragma('journal_mode = WAL'); // 部分文件系统不支持 WAL，失败不致命
        } catch (_) { /* ignore */ }
        db.exec(`
          CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            group_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            model_display TEXT,
            path TEXT,
            status TEXT NOT NULL,
            status_code INTEGER,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            latency_ms INTEGER,
            error TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_req_ts ON requests(ts);
          CREATE INDEX IF NOT EXISTS idx_req_model ON requests(model_id);
          CREATE INDEX IF NOT EXISTS idx_req_group ON requests(group_id);
          CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status);
        `);
        this._stmtInsert = db.prepare(`
          INSERT INTO requests (ts, group_id, model_id, model_display, path, status, status_code,
            prompt_tokens, completion_tokens, total_tokens, latency_ms, error)
          VALUES (@ts, @group_id, @model_id, @model_display, @path, @status, @status_code,
            @prompt_tokens, @completion_tokens, @total_tokens, @latency_ms, @error)
        `);
        this.db = db;
        this._dbFile = file;
        // 自动保留：清理超过保留期的历史明细
        try {
          db.prepare('DELETE FROM requests WHERE ts < ?').run(Date.now() - RETENTION_DAYS * 86400 * 1000);
        } catch (e) {
          console.error('[stats] retention cleanup failed:', e.message);
        }
        break;
      } catch (e) {
        console.error(`[stats] 打开统计库失败 (${file}):`, e.message);
      }
    }

    if (!this.db) {
      this._initFailed = true;
      console.error('[stats] 统计库不可用，统计功能已降级（不影响代理主流程）');
    } else if (this._dbFile !== DB_FILE) {
      console.warn(`[stats] 默认位置不可用，统计库使用备用位置: ${this._dbFile}`);
    }
  }

  recordRequest(entry) {
    try {
      if (!this.db) this.init();
      if (!this.db) return; // 统计不可用时不阻塞主流程
      const row = {
        ts: Date.now(),
        group_id: '',
        model_id: '',
        model_display: '',
        path: '',
        status: 'success',
        status_code: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        latency_ms: null,
        error: null,
        ...entry
      };
      this._stmtInsert.run(row);
    } catch (e) {
      console.error('[stats] insert failed:', e.message);
    }
  }

  // 按模型聚合
  getModelStats() {
    if (!this.db) this.init();
    if (!this.db) return [];
    return this.db.prepare(`
      SELECT
        model_id,
        model_display,
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_count,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        ROUND(AVG(latency_ms), 0) AS avg_latency_ms,
        ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate,
        MAX(ts) AS last_used
      FROM requests
      GROUP BY model_id
      ORDER BY total_requests DESC
    `).all();
  }

  // 按配置组聚合
  getGroupStats() {
    if (!this.db) this.init();
    if (!this.db) return [];
    return this.db.prepare(`
      SELECT
        group_id,
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_count,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        ROUND(AVG(latency_ms), 0) AS avg_latency_ms,
        ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate,
        MAX(ts) AS last_used
      FROM requests
      GROUP BY group_id
      ORDER BY total_requests DESC
    `).all();
  }

  // 最近 N 条明细
  getRecentRequests(limit = 100) {
    if (!this.db) this.init();
    if (!this.db) return [];
    return this.db.prepare(`
      SELECT ts, group_id, model_id, model_display, path, status, status_code,
        prompt_tokens, completion_tokens, total_tokens, latency_ms, error
      FROM requests
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  }

  // 按天聚合(最近 N 天)
  getDailyStats(days = 30) {
    if (!this.db) this.init();
    if (!this.db) return [];
    const since = Date.now() - days * 86400 * 1000;
    return this.db.prepare(`
      SELECT
        strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
        model_id,
        (SELECT model_display FROM requests r2 WHERE r2.model_id = requests.model_id ORDER BY r2.ts DESC LIMIT 1) AS model_display,
        COUNT(*) AS requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        ROUND(AVG(latency_ms), 0) AS avg_latency_ms,
        ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate
      FROM requests
      WHERE ts >= ?
      GROUP BY day, model_id
      ORDER BY day ASC
    `).all(since);
  }

  // 按小时聚合（最近 N 小时）
  getHourlyStats(hours = 24) {
    if (!this.db) this.init();
    if (!this.db) return [];
    const since = Date.now() - hours * 3600 * 1000;
    return this.db.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', ts / 1000, 'unixepoch', 'localtime') AS hour,
        model_id,
        (SELECT model_display FROM requests r2 WHERE r2.model_id = requests.model_id ORDER BY r2.ts DESC LIMIT 1) AS model_display,
        COUNT(*) AS requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate
      FROM requests
      WHERE ts >= ?
      GROUP BY hour, model_id
      ORDER BY hour ASC
    `).all(since);
  }

  // 总览
  getOverview() {
    if (!this.db) this.init();
    if (!this.db) return { total_requests: 0, success_count: 0, failure_count: 0, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, avg_latency_ms: 0, success_rate: 0, last_used: null };
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        ROUND(AVG(latency_ms), 0) AS avg_latency_ms,
        ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate,
        MAX(ts) AS last_used
      FROM requests
    `).get();
    return row || { total_requests: 0, success_count: 0, failure_count: 0, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, avg_latency_ms: 0, success_rate: 0, last_used: null };
  }

  // 清空所有统计
  clearAll() {
    if (!this.db) this.init();
    if (!this.db) return { success: true };
    this.db.exec('DELETE FROM requests');
    return { success: true };
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* ignore */ }
      this.db = null;
    }
  }
}

module.exports = new StatsManager();
