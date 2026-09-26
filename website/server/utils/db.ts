/**
 * SQLite 数据库层
 * 数据文件: .data/dsh-website.db（自动创建目录）
 * 表: users / favorites / comments / shares
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let _db: Database.Database | null = null

export function getDB(): Database.Database {
  if (_db) return _db

  const dataDir = join(process.cwd(), '..', '..', '.data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  _db = new Database(join(dataDir, 'dsh-website.db'))
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  migrate(_db)
  return _db
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      github_id TEXT UNIQUE,
      github_login TEXT,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plugin_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, plugin_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plugin_id TEXT NOT NULL,
      content TEXT NOT NULL CHECK(length(content) <= 1000),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      plugin_id TEXT NOT NULL,
      channel TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      plugin_name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'suggestion' CHECK(type IN ('bug','suggestion','experience','question','other')),
      content TEXT NOT NULL CHECK(length(content) <= 2000),
      contact TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ip_hash TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','resolved','closed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plugin_compat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      dsh_version TEXT NOT NULL DEFAULT '*',
      compatible INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(plugin_id, dsh_version)
    );

    CREATE TABLE IF NOT EXISTS plugin_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      conflict_with TEXT NOT NULL,
      reason TEXT,
      severity TEXT NOT NULL DEFAULT 'warn' CHECK(severity IN ('warn','block')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(plugin_id, conflict_with)
    );

    -- 组合包（Bundle 协议 V2，增量建表无迁移，V2 §2）
    CREATE TABLE IF NOT EXISTS bundles (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      tags TEXT,
      mode TEXT,
      min_dsh_version TEXT,
      max_dsh_version TEXT,
      recommend_preset TEXT,
      version TEXT,
      create_time TEXT
    );

    CREATE TABLE IF NOT EXISTS bundle_plugins (
      bundle_id TEXT,
      plugin_ref TEXT,
      required INTEGER,
      UNIQUE(bundle_id, plugin_ref)
    );

    CREATE TABLE IF NOT EXISTS bundle_mcp_servers (
      bundle_id TEXT,
      server_id TEXT,
      name TEXT,
      transport TEXT,
      command TEXT,
      args TEXT,
      env_keys TEXT,
      optional INTEGER,
      description TEXT,
      UNIQUE(bundle_id, server_id)
    );

    CREATE TABLE IF NOT EXISTS bundle_skills (
      bundle_id TEXT,
      skill_id TEXT,
      name TEXT,
      source TEXT,
      scope TEXT,
      optional INTEGER,
      UNIQUE(bundle_id, skill_id)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_plugin ON favorites(plugin_id);
    CREATE INDEX IF NOT EXISTS idx_comments_plugin ON comments(plugin_id, deleted);
    CREATE INDEX IF NOT EXISTS idx_shares_plugin ON shares(plugin_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_plugin ON feedback(plugin_id, status);
    CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
    CREATE INDEX IF NOT EXISTS idx_compat_plugin ON plugin_compat(plugin_id);
    CREATE INDEX IF NOT EXISTS idx_conflicts_plugin ON plugin_conflicts(plugin_id);

    -- Market V3 §5.3：订单/结算预留表（本期只建表不落资金流；社区化/计费列由 ensureMarketV3Columns 补）
    CREATE TABLE IF NOT EXISTS bundle_orders (
      order_id TEXT PRIMARY KEY,
      bundle_id TEXT,
      buyer_id TEXT,
      author_id TEXT,
      gross_cents INTEGER,
      commission_cents INTEGER,
      author_cents INTEGER,
      status TEXT DEFAULT 'created',
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orders_bundle ON bundle_orders(bundle_id);
    CREATE INDEX IF NOT EXISTS idx_orders_buyer ON bundle_orders(buyer_id);

    CREATE TABLE IF NOT EXISTS creator_ledgers (
      author_id TEXT,
      period TEXT,
      gross_cents INTEGER,
      commission_cents INTEGER,
      settled_cents INTEGER,
      status TEXT DEFAULT 'open',
      PRIMARY KEY (author_id, period)
    );

    -- 站点统计（自建轻量：日聚合计数，无个人数据。app ping 仅匿名随机安装 id + 版本号）
    CREATE TABLE IF NOT EXISTS stats_page_views (
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day, path)
    );

    CREATE TABLE IF NOT EXISTS stats_downloads (
      day TEXT NOT NULL,
      file TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day, file)
    );

    CREATE TABLE IF NOT EXISTS stats_app_pings (
      day TEXT NOT NULL,
      install_id TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(day, install_id)
    );
  `)

  // Market V3：组合包社区化 + 计费列（增量 ALTER TABLE，幂等补列；老库自动升级）
  ensureMarketV3Columns(db)
}

/** 幂等补列：列已存在则忽略「duplicate column name」，老库自动升级 */
function ensureMarketV3Columns(db: Database.Database): void {
  const add = (table: string, col: string, def: string): void => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
    } catch (e) {
      if (!/duplicate column/i.test(String((e as Error)?.message ?? e))) throw e
    }
  }
  // bundles：社区化 + 计费 + 审核
  add('bundles', 'source', "TEXT DEFAULT 'official'")
  add('bundles', 'author', 'TEXT')
  add('bundles', 'author_id', 'TEXT')
  add('bundles', 'share_time', 'TEXT')
  add('bundles', 'base_bundle_id', 'TEXT')
  add('bundles', 'review_status', "TEXT DEFAULT 'reviewed'")
  add('bundles', 'package_price_cents', 'INTEGER')
  add('bundles', 'commission_rate', 'REAL')
  add('bundles', 'pay_channel', 'TEXT')
  // bundle_plugins：简介 + 计费
  add('bundle_plugins', 'description', 'TEXT')
  add('bundle_plugins', 'billing', "TEXT DEFAULT 'free'")
  add('bundle_plugins', 'price_cents', 'INTEGER')
  // bundle_mcp_servers：简介 + 计费 + 周期
  add('bundle_mcp_servers', 'brief', 'TEXT')
  add('bundle_mcp_servers', 'billing', "TEXT DEFAULT 'free'")
  add('bundle_mcp_servers', 'price_cents', 'INTEGER')
  add('bundle_mcp_servers', 'billing_cycle', 'TEXT')
  // bundle_skills：简介 + 计费
  add('bundle_skills', 'description', 'TEXT')
  add('bundle_skills', 'billing', "TEXT DEFAULT 'free'")
}
