import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan TEXT NOT NULL,
        state TEXT NOT NULL, created INTEGER NOT NULL, deadline INTEGER NOT NULL, charge TEXT UNIQUE,
        review_at INTEGER, approved_by TEXT, expires INTEGER, rejection TEXT);
      CREATE TABLE IF NOT EXISTS subscriptions(user_id TEXT PRIMARY KEY REFERENCES users(id), url TEXT NOT NULL,
        expires INTEGER NOT NULL, status TEXT NOT NULL, order_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, event_key TEXT UNIQUE NOT NULL, recipient TEXT NOT NULL,
        text TEXT NOT NULL, sent INTEGER, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payment_incidents(update_id INTEGER PRIMARY KEY, payload TEXT NOT NULL,
        user_id TEXT NOT NULL, currency TEXT NOT NULL, amount INTEGER NOT NULL, charge TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created);
      CREATE INDEX IF NOT EXISTS orders_state ON orders(state, deadline);
      CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(sent, next_at);`);
  }
  one(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  log(actor, action, target, now = Date.now()) { this.run('INSERT INTO audit(at,actor,action,target) VALUES(?,?,?,?)', now, String(actor), action, target); }
  event(key, recipient, text) { this.run('INSERT OR IGNORE INTO outbox(event_key,recipient,text) VALUES(?,?,?)', key, String(recipient), text); }
  meta(key) { return this.one('SELECT value FROM meta WHERE key=?', key)?.value; }
  setMeta(key, value) { this.run('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }
  close() { this.db.close(); }
}
