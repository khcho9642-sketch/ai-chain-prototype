import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { ensure } from './policy.mjs'

const derive = promisify(scrypt)
const hash = value => createHash('sha256').update(value).digest('hex')
const passwordOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const reserved = new Set(['gpt', 'chatgpt', 'claude', 'gemini', 'admin', 'administrator', '관리자'])
export const actorForUser = id => hash(`member:${id}`)
export function username(value) {
  ensure(typeof value === 'string', 'invalid_username')
  const name = value.normalize('NFC').trim()
  ensure(/^[\p{L}\p{N}_-]{3,24}$/u.test(name) && !reserved.has(name.toLowerCase()), 'invalid_username')
  return name
}
function password(value) {
  ensure(typeof value === 'string' && [...value].length >= 12 && [...value].length <= 128 && Buffer.byteLength(value) <= 512, 'password_requires_12_to_128_characters')
  return value
}
async function passwordHash(value, salt) { return Buffer.from(await derive(value, salt, 32, passwordOptions)).toString('hex') }

/** Invite-only member authentication. Session/invite tokens are hashed at rest.
 * The shared SQLite connection is owned by CommunityStore; no async transaction is held.
 */
export class CommunityAuth {
  constructor(store, { allowRegistration = false } = {}) {
    this.store = store; this.db = store.db; this.now = store.now; this.allowRegistration = allowRegistration
    this.activeHashes = 0
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS community_users (
        id TEXT PRIMARY KEY, actor TEXT UNIQUE NOT NULL, login TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('member','admin')), disabled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS community_member_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES community_users(id), expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS community_session_expiry ON community_member_sessions(expires);
      CREATE TABLE IF NOT EXISTS community_invites (
        token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS community_rate_limits (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    `)
    store.resolveHumanName = actor => this.db.prepare('SELECT name FROM community_users WHERE actor=?').get(actor)?.name || '이전 사용자'
  }
  limit(key, max = 8, windowMs = 60000) {
    const now = this.now()
    // Bound retained IP/account hashes; do not store raw addresses or passwords.
    this.db.prepare('DELETE FROM community_rate_limits WHERE expires<=?').run(now)
    this.store.tx(() => {
      const row = this.db.prepare('SELECT count FROM community_rate_limits WHERE key=?').get(key)
      ensure(!row || row.count < max, 'rate_limited', 429)
      this.db.prepare('INSERT INTO community_rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + windowMs)
    })
  }
  async derive(value, salt) {
    ensure(this.activeHashes < 4, 'authentication_busy', 429)
    this.activeHashes++
    try { return await passwordHash(value, salt) } finally { this.activeHashes-- }
  }
  invite() {
    const token = randomBytes(32).toString('hex'), expires = this.now() + 86400000
    this.db.prepare('DELETE FROM community_invites WHERE expires<=? OR used=1').run(this.now())
    this.db.prepare('INSERT INTO community_invites(token_hash,expires) VALUES(?,?)').run(hash(token), expires)
    return { token, expiresAt: new Date(expires).toISOString() }
  }
  async create({ name, password: secret, invite }, { role = 'member', bootstrap = false } = {}) {
    const display = username(name), login = display.toLowerCase()
    password(secret)
    ensure(['member', 'admin'].includes(role), 'invalid_role')
    ensure(role !== 'admin' || bootstrap, 'admin_creation_forbidden', 403)
    let inviteHash
    const checkInvite = () => {
      if (bootstrap || this.allowRegistration) return
      ensure(typeof invite === 'string' && /^[a-f0-9]{64}$/.test(invite), 'valid_invite_required', 403)
      inviteHash = hash(invite)
      const row = this.db.prepare('SELECT * FROM community_invites WHERE token_hash=?').get(inviteHash)
      ensure(row && !row.used && row.expires > this.now(), 'valid_invite_required', 403)
    }
    checkInvite()
    ensure(!this.db.prepare('SELECT 1 FROM community_users WHERE login=?').get(login), 'username_unavailable', 409)
    const salt = randomBytes(16).toString('hex'), digest = await this.derive(secret, salt), id = randomUUID()
    this.store.tx(() => {
      checkInvite()
      ensure(!this.db.prepare('SELECT 1 FROM community_users WHERE login=?').get(login), 'username_unavailable', 409)
      this.db.prepare('INSERT INTO community_users(id,actor,login,name,salt,password_hash,role,created) VALUES(?,?,?,?,?,?,?,?)').run(id, actorForUser(id), login, display, salt, digest, role, this.now())
      if (inviteHash) this.db.prepare('UPDATE community_invites SET used=1 WHERE token_hash=?').run(inviteHash)
      this.store.audit('member_created', id)
    })
    return { id, name: display, role }
  }
  async login({ name, password: secret }) {
    ensure(typeof name === 'string' && name.length <= 100 && typeof secret === 'string' && Buffer.byteLength(secret) <= 512, 'invalid_credentials', 401)
    const row = this.db.prepare('SELECT * FROM community_users WHERE login=?').get(name.normalize('NFC').trim().toLowerCase())
    // Unknown users perform the same expensive operation, avoiding a cheap username oracle.
    const digest = await this.derive(secret, row?.salt || '00000000000000000000000000000000')
    ensure(row && !row.disabled && timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(row.password_hash, 'hex')), 'invalid_credentials', 401)
    this.db.prepare('DELETE FROM community_member_sessions WHERE expires<=?').run(this.now())
    const token = randomBytes(32).toString('hex'), expires = this.now() + 12 * 3600000
    this.store.tx(() => {
      const current = this.db.prepare('SELECT password_hash,disabled FROM community_users WHERE id=?').get(row.id)
      ensure(current && !current.disabled && current.password_hash === row.password_hash, 'invalid_credentials', 401)
      // Limit outstanding logins per member without forcing all other devices offline.
      const old = this.db.prepare('SELECT token_hash FROM community_member_sessions WHERE user_id=? ORDER BY expires DESC LIMIT -1 OFFSET 4').all(row.id)
      for (const x of old) this.db.prepare('DELETE FROM community_member_sessions WHERE token_hash=?').run(x.token_hash)
      this.db.prepare('INSERT INTO community_member_sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(hash(token), row.id, expires)
    })
    return { token, expiresAt: new Date(expires).toISOString(), user: { id: row.id, name: row.name, role: row.role } }
  }
  user(token) {
    ensure(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'login_required', 401)
    const row = this.db.prepare('SELECT u.id,u.name,u.role,u.disabled FROM community_member_sessions s JOIN community_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(hash(token), this.now())
    ensure(row && !row.disabled, 'login_required', 401)
    return { id: row.id, name: row.name, role: row.role }
  }
  logout(token) {
    if (typeof token === 'string') this.db.prepare('DELETE FROM community_member_sessions WHERE token_hash=?').run(hash(token))
  }
  async reset(name, secret) {
    password(secret)
    const row = this.db.prepare('SELECT id FROM community_users WHERE login=?').get(username(name).toLowerCase())
    ensure(row, 'member_not_found', 404)
    const salt = randomBytes(16).toString('hex'), digest = await this.derive(secret, salt)
    this.store.tx(() => {
      this.db.prepare('UPDATE community_users SET salt=?,password_hash=? WHERE id=?').run(salt, digest, row.id)
      this.db.prepare('DELETE FROM community_member_sessions WHERE user_id=?').run(row.id)
      this.store.audit('password_reset', row.id)
    })
  }
}
