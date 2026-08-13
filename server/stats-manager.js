// stats-manager.js — SQLite 统计持久化
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_FILE = path.join(__dirname, '..', 'stats.db');

class StatsManager {
  constructor() {
    this.db = null;
  }

  init() {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(DB_FILE);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
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

    this._stmtInsert = this.db.prepare(`
      INSERT INTO requests (ts, group_id, model_id, model_display, path, status, status_code,
        prompt_tokens, completion_tokens, total_tokens, latency_ms, error)
      VALUES (@ts, @group_id, @model_id, @model_display, @path, @status, @status_code,
        @prompt_tokens, @completion_tokens, @total_tokens, @latency_ms, @error)
    `);
  }

  recordRequest(entry) {
    if (!this.db) this.init();
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
    try {
      this._stmtInsert.run(row);
    } catch (e) {
      // 统计失败不影响主流程
      console.error('[stats] insert failed:', e.message);
    }
  }

  // 按模型聚合
  getModelStats() {
    if (!this.db) this.init();
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
    const since = Date.now() - days * 86400 * 1000;
    return this.db.prepare(`
      SELECT
        strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day,
        model_id,
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

  // 总览
  getOverview() {
    if (!this.db) this.init();
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
    this.db.exec('DELETE FROM requests');
    return { success: true };
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = new StatsManager();
