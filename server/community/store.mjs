import { DatabaseSync } from 'node:sqlite'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { AGENTS, PROMPT_VERSION, ensure, text, validateOutput, kstDay } from './policy.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const DAY = 86400000
const TERMINAL = ['published', 'skipped', 'expired', 'cancelled', 'failed', 'blocked', 'rejected']
export class CommunityStore extends EventEmitter {
  constructor({ path = ':memory:', catalog, now = Date.now } = {}) {
    super()
    ensure(Array.isArray(catalog) && catalog.length > 0, 'catalog_required')
    this.catalog = new Map(catalog.map(x => [x.symbol, x.name])); this.now = now
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS community_settings (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO community_settings(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS community_agents (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS community_sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS community_comments (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, symbol TEXT NOT NULL,
        parent TEXT REFERENCES community_comments(id), kind TEXT NOT NULL CHECK(kind IN ('human','ai')),
        author TEXT NOT NULL, body TEXT NOT NULL, allow_ai INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL, interaction TEXT NOT NULL, depth INTEGER NOT NULL, job_id TEXT UNIQUE);
      CREATE INDEX IF NOT EXISTS community_comment_symbol ON community_comments(symbol,seq);
      CREATE TABLE IF NOT EXISTS community_jobs (
        id TEXT PRIMARY KEY, dedupe TEXT UNIQUE NOT NULL, symbol TEXT NOT NULL, parent TEXT REFERENCES community_comments(id),
        source TEXT REFERENCES community_comments(id), interaction TEXT NOT NULL, agent TEXT NOT NULL REFERENCES community_agents(id),
        state TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, ready INTEGER NOT NULL,
        lease TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0, draft TEXT, reason TEXT,
        model TEXT, cli_version TEXT, prompt_version TEXT, completed INTEGER);
      CREATE INDEX IF NOT EXISTS community_jobs_ready ON community_jobs(state,ready);
      CREATE TABLE IF NOT EXISTS community_usage (agent TEXT, day TEXT, attempts INTEGER DEFAULT 0, published INTEGER DEFAULT 0, PRIMARY KEY(agent,day));
      CREATE TABLE IF NOT EXISTS community_requests (key TEXT PRIMARY KEY, session TEXT NOT NULL, digest TEXT NOT NULL, comment_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS community_policy (
        id INTEGER PRIMARY KEY CHECK(id=1), publish_mode TEXT NOT NULL DEFAULT 'review_only',
        daily_attempts INTEGER NOT NULL DEFAULT 150, daily_posts INTEGER NOT NULL DEFAULT 100);
      INSERT OR IGNORE INTO community_policy(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS community_symbol_settings (symbol TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS community_workers (id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS community_audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
    `)
    for (const agent of Object.keys(AGENTS)) this.db.prepare('INSERT OR IGNORE INTO community_agents(id) VALUES(?)').run(agent)
  }
  close() { this.db.close() }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  audit(action, target) { this.db.prepare('INSERT INTO community_audit(at,action,target) VALUES(?,?,?)').run(this.now(), action, target) }
  notify(symbol = null) { this.emit('wake', { symbol }) }
  settings() {
    const policy = this.db.prepare('SELECT * FROM community_policy WHERE id=1').get()
    return { paused: !!this.db.prepare('SELECT paused FROM community_settings WHERE id=1').get().paused,
      agents: this.db.prepare('SELECT * FROM community_agents').all(), mode: policy.publish_mode,
      limits: { dailyAttempts: policy.daily_attempts, dailyPosts: policy.daily_posts },
      disabledSymbols: this.db.prepare('SELECT symbol FROM community_symbol_settings WHERE enabled=0').all().map(x => x.symbol) }
  }
  configure({ paused, agent, enabled, symbol, mode, dailyAttempts, dailyPosts }) {
    this.tx(() => {
      if (paused !== undefined) { ensure(typeof paused === 'boolean', 'invalid_setting'); this.db.prepare('UPDATE community_settings SET paused=? WHERE id=1').run(+paused) }
      if (agent !== undefined) { ensure(AGENTS[agent] && typeof enabled === 'boolean', 'invalid_agent'); this.db.prepare('UPDATE community_agents SET enabled=? WHERE id=?').run(+enabled, agent) }
      if (symbol !== undefined) {
        ensure(this.catalog.has(symbol) && typeof enabled === 'boolean', 'invalid_symbol_setting')
        this.db.prepare('INSERT INTO community_symbol_settings(symbol,enabled) VALUES(?,?) ON CONFLICT(symbol) DO UPDATE SET enabled=excluded.enabled').run(symbol, +enabled)
        if (!enabled) this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='symbol_disabled' WHERE symbol=? AND state IN ('queued','running','awaiting_approval')").run(symbol)
      }
      if (mode !== undefined) {
        ensure(['review_only','auto'].includes(mode), 'invalid_mode')
        this.db.prepare('UPDATE community_policy SET publish_mode=? WHERE id=1').run(mode)
      }
      for (const [value, column] of [[dailyAttempts, 'daily_attempts'], [dailyPosts, 'daily_posts']]) {
        if (value !== undefined) {
          ensure(Number.isInteger(value) && value >= 1 && value <= 1000, 'invalid_daily_limit')
          this.db.prepare(`UPDATE community_policy SET ${column}=? WHERE id=1`).run(value)
        }
      }
      // A normal stop invalidates in-flight work; it must not publish after a later restart.
      if (paused === true) this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='admin_paused' WHERE state IN ('queued','running','awaiting_approval')").run()
      if (agent && enabled === false) this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='agent_disabled' WHERE agent=? AND state IN ('queued','running','awaiting_approval')").run(agent)
      this.audit('configure', JSON.stringify({ paused, agent, enabled, symbol, mode, dailyAttempts, dailyPosts }))
    }); this.notify(); return this.settings()
  }
  session(token) {
    const now = this.now()
    this.db.prepare('DELETE FROM community_sessions WHERE expires<=?').run(now)
    if (token && /^[a-f0-9]{64}$/.test(token) && this.db.prepare('SELECT 1 FROM community_sessions WHERE hash=? AND expires>?').get(hash(token), now)) return token
    const fresh = randomBytes(32).toString('hex')
    this.db.prepare('INSERT INTO community_sessions(hash,expires) VALUES(?,?)').run(hash(fresh), now + 7 * DAY)
    return fresh
  }
  publicComment(row) {
    if (!row) return null
    const meta = row.job_id ? this.db.prepare('SELECT model,cli_version,prompt_version FROM community_jobs WHERE id=?').get(row.job_id) : null
    return { id: row.id, seq: row.seq, symbol: row.symbol, parent: row.parent, kind: row.kind,
      name: row.kind === 'ai' ? AGENTS[row.author].name : (this.resolveHumanName?.(row.author) || '로컬 사용자'), agent: row.kind === 'ai' ? row.author : null,
      text: row.hidden ? '' : row.body, hidden: !!row.hidden, allowAi: !!row.allow_ai,
      createdAt: new Date(row.created).toISOString(), depth: row.depth, metadata: meta }
  }
  comments(symbol, before = Number.MAX_SAFE_INTEGER) {
    ensure(this.catalog.has(symbol), 'unknown_symbol', 404)
    ensure(Number.isSafeInteger(before) && before > 0, 'invalid_cursor')
    const rows = this.db.prepare('SELECT * FROM community_comments WHERE symbol=? AND seq<? ORDER BY seq DESC LIMIT 50').all(symbol, before)
    const counts = this.db.prepare('SELECT kind,COUNT(*) AS count FROM community_comments WHERE symbol=? AND hidden=0 GROUP BY kind').all(symbol)
    return { comments: rows.reverse().map(x => this.publicComment(x)), counts: Object.fromEntries(counts.map(x => [x.kind, x.count])), nextBefore: rows.length === 50 ? rows[0].seq : null }
  }
  addHuman({ symbol, body, parent = null, allowAi = true, requestId }, session) {
    ensure(this.catalog.has(symbol), 'unknown_symbol', 404)
    ensure(typeof allowAi === 'boolean' && typeof requestId === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(requestId), 'invalid_request')
    const content = text(body); const digest = hash(JSON.stringify({ symbol, content, parent, allowAi }))
    const actor = hash(session); const key = `${actor}:${requestId}`
    const result = this.tx(() => {
      const old = this.db.prepare('SELECT * FROM community_requests WHERE key=?').get(key)
      if (old) { ensure(old.digest === digest, 'idempotency_conflict', 409); return this.publicComment(this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(old.comment_id)) }
      ensure(this.db.prepare("SELECT COUNT(*) AS n FROM community_comments WHERE author=? AND kind='human' AND created>?").get(actor, this.now() - 60000).n < 5, 'rate_limited', 429)
      let p = null
      if (parent) { p = this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(parent); ensure(p && p.symbol === symbol && !p.hidden, 'invalid_parent'); ensure(p.depth < 12, 'reply_too_deep'); if (!p.allow_ai) allowAi = false }
      const id = randomUUID(), interaction = randomUUID(), now = this.now()
      this.db.prepare("INSERT INTO community_comments(id,symbol,parent,kind,author,body,allow_ai,created,interaction,depth) VALUES(?,?,?,'human',?,?,?,?,?,?)").run(id, symbol, parent, actor, content, +allowAi, now, interaction, p ? p.depth + 1 : 0)
      this.db.prepare('INSERT INTO community_requests(key,session,digest,comment_id) VALUES(?,?,?,?)').run(key, actor, digest, id)
      if (allowAi) this.schedule({ symbol, parent: id, source: id, interaction, preferred: p?.kind === 'ai' ? p.author : null })
      return this.publicComment(this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(id))
    }); this.notify(symbol); return result
  }
  schedule({ symbol, parent = null, source = null, interaction, preferred = null }) {
    if (this.settings().paused || this.settings().disabledSymbols.includes(symbol)) return null
    const jobs = this.db.prepare('SELECT agent,state FROM community_jobs WHERE interaction=?').all(interaction)
    if (jobs.length >= 6 || jobs.some(x => !TERMINAL.includes(x.state))) return null
    const p = parent ? this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(parent) : null
    if (p?.hidden) return null
    const aiDepth = this.db.prepare("SELECT COUNT(*) AS n FROM community_comments WHERE interaction=? AND kind='ai'").get(interaction).n
    if (aiDepth >= 4) return null
    const candidates = this.settings().agents.filter(a => a.enabled && jobs.filter(j => j.agent === a.id).length < 2 && !(p?.kind === 'ai' && p.author === a.id))
    if (!candidates.length) return null
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM community_jobs').get().n
    const agent = candidates.find(a => a.id === preferred)?.id || candidates[total % candidates.length].id
    const id = randomUUID(), now = this.now()
    this.db.prepare("INSERT INTO community_jobs(id,dedupe,symbol,parent,source,interaction,agent,state,created,expires,ready) VALUES(?,?,?,?,?,?,?,'queued',?,?,?)").run(id, `${interaction}:${jobs.length}`, symbol, parent, source, interaction, agent, now, now + DAY, now)
    return id
  }
  request(symbol) {
    ensure(this.catalog.has(symbol), 'unknown_symbol', 404)
    const id = this.tx(() => this.schedule({ symbol, interaction: randomUUID() }))
    this.audit('manual_request', symbol); this.notify(symbol); return { jobId: id }
  }
  recover() {
    const now = this.now()
    this.db.prepare("UPDATE community_jobs SET state='expired',reason='expired' WHERE expires<=? AND state IN ('queued','running','awaiting_approval')").run(now)
    this.db.prepare("UPDATE community_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END, ready=?,lease=NULL,lease_until=NULL,reason='lease_expired' WHERE state='running' AND lease_until<=?").run(now, now)
  }
  runnable(job) {
    if (this.settings().paused || this.settings().disabledSymbols.includes(job.symbol) || !this.settings().agents.find(a => a.id === job.agent)?.enabled || job.expires <= this.now()) return false
    for (const id of [job.source, job.parent].filter(Boolean)) {
      const c = this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(id)
      if (!c || c.hidden || !c.allow_ai || c.symbol !== job.symbol) return false
    }
    return true
  }
  claim(agents) {
    ensure(Array.isArray(agents) && agents.length > 0 && agents.length <= 3 && agents.every(a => AGENTS[a]), 'invalid_agents')
    return this.tx(() => {
      this.recover(); const now = this.now(), day = kstDay(now)
      if (this.settings().paused) return { job: null, nextDue: null }
      const rows = this.db.prepare("SELECT * FROM community_jobs WHERE state='queued' AND ready<=? AND agent IN (SELECT value FROM json_each(?)) ORDER BY created,id LIMIT 100").all(now, JSON.stringify(agents))
      for (const row of rows) {
        if (!agents.includes(row.agent)) continue
        if (!this.runnable(row)) { this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='no_longer_eligible' WHERE id=?").run(row.id); continue }
        if (this.db.prepare("SELECT 1 FROM community_jobs WHERE state='running' AND (agent=? OR symbol=?)").get(row.agent, row.symbol)) continue
        this.db.prepare('INSERT OR IGNORE INTO community_usage(agent,day) VALUES(?,?)').run(row.agent, day)
        const usage = this.db.prepare('SELECT * FROM community_usage WHERE agent=? AND day=?').get(row.agent, day)
        if (usage.attempts >= this.settings().limits.dailyAttempts || usage.published >= this.settings().limits.dailyPosts) { this.db.prepare("UPDATE community_jobs SET state='blocked',reason='daily_limit' WHERE id=?").run(row.id); continue }
        const lease = randomUUID()
        this.db.prepare("UPDATE community_jobs SET state='running',lease=?,lease_until=?,attempts=attempts+1 WHERE id=?").run(lease, now + 180000, row.id)
        this.db.prepare('UPDATE community_usage SET attempts=attempts+1 WHERE agent=? AND day=?').run(row.agent, day)
        // Human-only comments are not sent to model providers.
        const recent = this.db.prepare('SELECT * FROM community_comments WHERE symbol=? AND hidden=0 AND allow_ai=1 ORDER BY seq DESC LIMIT 20').all(row.symbol)
        const referenced = [row.source, row.parent].filter(Boolean).map(id => this.db.prepare('SELECT * FROM community_comments WHERE id=? AND hidden=0 AND allow_ai=1').get(id)).filter(Boolean)
        const context = [...new Map([...recent, ...referenced].map(x => [x.id, x])).values()].sort((a,b) => a.seq-b.seq).map(x => ({ id: x.id, kind: x.kind, agent: x.kind === 'ai' ? x.author : null, text: x.body }))
        return { job: { id: row.id, lease, agent: row.agent, symbol: row.symbol, company: this.catalog.get(row.symbol), parent: row.parent, context }, nextDue: null }
      }
      const dues = this.db.prepare("SELECT agent,CASE WHEN state='running' THEN lease_until ELSE ready END AS due FROM community_jobs WHERE state IN ('queued','running')").all().filter(x => agents.includes(x.agent) && x.due > now)
      return { job: null, nextDue: dues.length ? Math.min(...dues.map(x => x.due)) : null }
    })
  }
  finish({ id, lease, output, model, cliVersion }) {
    const result = this.tx(() => {
      const job = this.db.prepare('SELECT * FROM community_jobs WHERE id=?').get(id)
      ensure(job && job.lease === lease, 'stale_lease', 409)
      if (['awaiting_approval', 'published', 'skipped'].includes(job.state)) return { state: job.state }
      ensure(job.state === 'running' && job.lease_until > this.now(), 'stale_lease', 409)
      if (!this.runnable(job)) { this.db.prepare("UPDATE community_jobs SET state='cancelled' WHERE id=?").run(id); return { state: 'cancelled' } }
      const valid = validateOutput(output)
      ensure(typeof model === 'string' && model.length > 0 && model.length <= 120 && typeof cliVersion === 'string' && cliVersion.length <= 120, 'invalid_provenance')
      const state = valid.action === 'skip' ? 'skipped' : 'awaiting_approval'
      this.db.prepare('UPDATE community_jobs SET state=?,draft=?,reason=?,model=?,cli_version=?,prompt_version=?,completed=? WHERE id=?').run(state, valid.text, valid.reason, model, cliVersion, PROMPT_VERSION, this.now(), id)
      this.audit('draft', id); return { state }
    })
    if (result.state === 'awaiting_approval' && this.settings().mode === 'auto') {
      try { const comment = this.approve(id); return { state: 'published', commentId: comment.id } }
      catch (error) {
        // A stop, duplicate or budget race must not silently publish or force regeneration.
        this.audit('auto_publish_deferred', id)
        return { state: this.db.prepare('SELECT state FROM community_jobs WHERE id=?').get(id).state, reason: error.code || 'review_required' }
      }
    }
    return result
  }
  fail({ id, lease, code = 'cli_failed', retryable = false }) {
    const result = this.tx(() => {
      const job = this.db.prepare('SELECT * FROM community_jobs WHERE id=?').get(id)
      ensure(job && job.state === 'running' && job.lease === lease && job.lease_until > this.now(), 'stale_lease', 409)
      const state = retryable && job.attempts < 3 ? 'queued' : 'blocked'
      const ready = this.now() + 1000 * 2 ** job.attempts
      this.db.prepare('UPDATE community_jobs SET state=?,reason=?,ready=?,lease=NULL,lease_until=NULL WHERE id=?').run(state, String(code).slice(0, 80), ready, id)
      return { state, nextDue: state === 'queued' ? ready : null }
    }); this.notify(); return result
  }
  approve(id) {
    const result = this.tx(() => {
      const job = this.db.prepare('SELECT * FROM community_jobs WHERE id=?').get(id)
      ensure(job, 'unknown_job', 404)
      if (job.state === 'published') return this.publicComment(this.db.prepare('SELECT * FROM community_comments WHERE job_id=?').get(id))
      ensure(job.state === 'awaiting_approval', 'not_awaiting_approval', 409)
      ensure(this.runnable(job), 'no_longer_eligible', 409)
      const body = validateOutput({ action: 'reply', text: job.draft }).text
      ensure(!this.db.prepare('SELECT 1 FROM community_comments WHERE symbol=? AND author=? AND body=? AND hidden=0 AND created>?').get(job.symbol, job.agent, body, this.now() - DAY), 'duplicate_comment', 409)
      const day = kstDay(this.now())
      this.db.prepare('INSERT OR IGNORE INTO community_usage(agent,day) VALUES(?,?)').run(job.agent, day)
      ensure(this.db.prepare('SELECT published FROM community_usage WHERE agent=? AND day=?').get(job.agent, day).published < this.settings().limits.dailyPosts, 'daily_limit', 429)
      const parent = job.parent ? this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(job.parent) : null
      const commentId = randomUUID()
      this.db.prepare("INSERT INTO community_comments(id,symbol,parent,kind,author,body,allow_ai,created,interaction,depth,job_id) VALUES(?,?,?,'ai',?,?,1,?,?,?,?)").run(commentId, job.symbol, job.parent, job.agent, body, this.now(), job.interaction, parent ? parent.depth + 1 : 0, id)
      this.db.prepare("UPDATE community_jobs SET state='published',completed=? WHERE id=?").run(this.now(), id)
      this.db.prepare('UPDATE community_usage SET published=published+1 WHERE agent=? AND day=?').run(job.agent, day)
      this.audit('approve', id)
      this.schedule({ symbol: job.symbol, parent: commentId, source: job.source, interaction: job.interaction })
      return this.publicComment(this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(commentId))
    }); this.notify(result.symbol); return result
  }
  reject(id) {
    ensure(this.db.prepare("UPDATE community_jobs SET state='rejected',draft=NULL WHERE id=? AND state='awaiting_approval'").run(id).changes, 'not_awaiting_approval', 409)
    this.audit('reject', id); return { state: 'rejected' }
  }
  hide(id) {
    this.tx(() => {
      ensure(this.db.prepare('UPDATE community_comments SET hidden=1 WHERE id=?').run(id).changes, 'unknown_comment', 404)
      this.db.prepare("UPDATE community_jobs SET state='cancelled',draft=NULL WHERE (parent=? OR source=?) AND state IN ('queued','running','awaiting_approval')").run(id, id)
      this.audit('hide', id)
    }); this.notify(); return { hidden: true }
  }
  touchWorker(id, state = 'connected') {
    ensure(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id), 'invalid_worker_id')
    this.db.prepare('DELETE FROM community_workers WHERE last_seen<?').run(this.now() - DAY)
    this.db.prepare('INSERT INTO community_workers(id,last_seen,state) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,state=excluded.state').run(id, this.now(), state)
  }
  admin() { this.recover(); return { ...this.settings(), workers: this.db.prepare('SELECT * FROM community_workers ORDER BY last_seen DESC LIMIT 10').all(), jobs: this.db.prepare('SELECT id,symbol,agent,state,draft,reason,model,cli_version,created,attempts FROM community_jobs ORDER BY created DESC LIMIT 100').all() } }
}
