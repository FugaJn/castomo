#!/usr/bin/env node
'use strict';
/*
 * Admin CLI. Run on the server, next to the database. Works while the server is running.
 *   node admin.js list
 *   node admin.js grant <nickname> [admin|owner]
 *   node admin.js revoke <nickname>
 * Whoever can run this has shell access to the server, so it is the safest way to bootstrap the first owner.
 */
const path = require('node:path');
const { openDb } = require('./db.js');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const [cmd, nick, roleArg] = process.argv.slice(2);
const usage = () => { console.log('Usage:\n  node admin.js list\n  node admin.js grant <nickname> [admin|owner]\n  node admin.js revoke <nickname>'); process.exit(1); };
if (!['list', 'grant', 'revoke'].includes(cmd)) usage();

const db = openDb(path.join(dataDir, 'castomo.db'));
const log = (actor, action, target, detail) => db.prepare('INSERT INTO audit_log(actor,actor_nick,action,target,detail,created_at) VALUES(NULL,?,?,?,?,?)').run('cli', action, target, detail, new Date().toISOString());

if (cmd === 'list') {
  const rows = db.prepare("SELECT nick, role, created_at FROM users WHERE role!='user' ORDER BY role DESC, nick").all();
  if (!rows.length) console.log('No admins yet. Register an account, then: node admin.js grant <nickname> owner');
  rows.forEach((r) => console.log(`${r.role.padEnd(6)} ${r.nick}`));
} else {
  if (!nick) usage();
  const u = db.prepare('SELECT id, nick, role FROM users WHERE nick=?').get(nick);
  if (!u) { console.error(`No user named "${nick}". They must register first.`); process.exit(2); }
  if (cmd === 'grant') {
    const role = roleArg || 'admin';
    if (!['admin', 'owner'].includes(role)) usage();
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, u.id);
    log(null, 'role.grant', u.nick, role);
    console.log(`${u.nick} is now ${role}.`);
  } else {
    const owners = db.prepare("SELECT COUNT(*) c FROM users WHERE role='owner'").get().c;
    if (u.role === 'owner' && owners <= 1 && process.argv.includes('--force') === false) { console.error('That is the only owner. Add another owner first, or pass --force.'); process.exit(3); }
    db.prepare("UPDATE users SET role='user' WHERE id=?").run(u.id);
    log(null, 'role.revoke', u.nick, u.role);
    console.log(`${u.nick} is now a regular user.`);
  }
}
db.close();
