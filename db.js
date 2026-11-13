'use strict';
/* SQLite schema and helpers (node:sqlite, Node 22.5+). */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const D = require('./public/spots.js');

const SCHEMA_V1 = `
CREATE TABLE users(
  id TEXT PRIMARY KEY,
  nick TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  pw TEXT NOT NULL,
  spot TEXT NOT NULL DEFAULT 'nagoya',
  style TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT 'any',
  bio TEXT NOT NULL DEFAULT '',
  langs TEXT NOT NULL DEFAULT '["en"]',
  fish TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin','owner')),
  created_at TEXT NOT NULL
);
CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE friendships(
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_a,user_b)
);
CREATE TABLE posts(
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  spot TEXT NOT NULL,
  custom TEXT NOT NULL DEFAULT '',
  meet TEXT NOT NULL,
  fish TEXT NOT NULL,
  transport TEXT NOT NULL CHECK(transport IN ('car','ride','transit')),
  seats INTEGER NOT NULL DEFAULT 0,
  seats_free INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX posts_date ON posts(date,time);
CREATE TABLE post_members(
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(post_id,user_id)
);
CREATE TABLE post_requests(
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  need_ride INTEGER NOT NULL DEFAULT 0,
  can_drive INTEGER NOT NULL DEFAULT 0,
  msg TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(post_id,user_id)
);
CREATE TABLE catches(
  id TEXT PRIMARY KEY,
  by_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  when_date TEXT NOT NULL,
  loc_k TEXT NOT NULL CHECK(loc_k IN ('spot','area','custom')),
  loc_v TEXT NOT NULL,
  fish TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  photo TEXT NOT NULL DEFAULT '',
  cap TEXT NOT NULL DEFAULT '',
  rod TEXT NOT NULL DEFAULT '',
  reel TEXT NOT NULL DEFAULT '',
  line TEXT NOT NULL DEFAULT '',
  lure TEXT NOT NULL DEFAULT '',
  tackle_pub INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX catches_when ON catches(when_date DESC, created_at DESC);
CREATE TABLE catch_likes(
  catch_id TEXT NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(catch_id,user_id)
);
CREATE TABLE catch_comments(
  id TEXT PRIMARY KEY,
  catch_id TEXT NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX catch_comments_catch ON catch_comments(catch_id,created_at);
CREATE TABLE groups(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  descr TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE group_members(
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(group_id,user_id)
);
CREATE TABLE messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL DEFAULT '',
  sys TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX messages_room ON messages(room,id);
CREATE TABLE reads(
  room TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(room,user_id)
);
`;

const SCHEMA_V2 = `
CREATE TABLE spots(
  id TEXT PRIMARY KEY,
  en TEXT NOT NULL,
  ja TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('s','b','f')),
  pref TEXT NOT NULL,
  mean REAL NOT NULL DEFAULT 100,
  a REAL NOT NULL DEFAULT 45,
  p REAL NOT NULL DEFAULT 2,
  p2 REAL NOT NULL DEFAULT 3,
  p3 REAL NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE feedback(
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('bug','idea','other')),
  text TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','done','wontfix')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX feedback_status ON feedback(status,created_at DESC);
CREATE INDEX feedback_user ON feedback(user_id,created_at DESC);
CREATE TABLE audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_nick TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX audit_when ON audit_log(id DESC);
`;

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw e;
  }
}

/* Built-in spots are copied into the database once, so an admin can edit, hide or add to them.
   Existing rows are never overwritten, so admin edits survive restarts and upgrades. */
function seedSpots(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO spots(id,en,ja,type,pref,mean,a,p,p2,p3,builtin,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,1,?)');
  const now = new Date().toISOString();
  tx(db, () => { for (const s of D.SPOTS) ins.run(s.id, s.en, s.ja, s.type, s.pref, s.mean, s.a, s.p, s.p2, s.p3, now); });
}

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v < 1) tx(db, () => { db.exec(SCHEMA_V1); db.exec('PRAGMA user_version=1'); });
  if (v < 2) tx(db, () => { db.exec(SCHEMA_V2); db.exec('PRAGMA user_version=2'); });
  seedSpots(db);
  return db;
}

module.exports = { openDb, tx };
