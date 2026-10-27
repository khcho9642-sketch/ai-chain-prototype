import { DatabaseSync } from 'node:sqlite'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, lstatSync, realpathSync, chmodSync } from 'node:fs'
import { dirname, resolve, isAbsolute, relative, sep } from 'node:path'
import { AGENTS, PROMPT_VERSION, ensure, text, validateOutput, kstDay } from './policy.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const DAY = 86400000
const TERMINAL = ['published', 'skipped', 'expired', 'cancelled', 'failed', 'blocked', 'rejected']
const ACTIVE = ['queued', 'running', 'awaiting_approval']
const json = value => JSON.stringify(value)
const parse = (value, fallback = null) => value ? JSON.parse(value) : fallback
const EVIDENCE_FIELDS = ['id', 'symbol', 'kind', 'label', 'value', 'unit', 'observedAt', 'collectedAt', 'sourceUrl', 'titleOnly', 'stale', 'period']
const LIMIT_COLUMNS = { dailyAttempts: ['daily_attempts', 1, 1000], dailyPosts: ['daily_posts', 1, 1000], userSymbolDailyAttempts: ['user_symbol_attempts', 1, 1000], symbolDailyAttempts: ['symbol_attempts', 1, 3000], maxConcurrent: ['max_concurrent', 1, 3], maxFollowups: ['max_followups', 0, 4], maxAgentPerInteraction: ['max_agent_interaction', 1, 2] }
export class CommunityStore extends EventEmitter {
  constructor({ path = ':memory:', catalog, now = Date.now, evidenceSource = () => null } = {}) {
    super()
    ensure(Array.isArray(catalog) && catalog.length > 0, 'catalog_required')
    this.catalog = new Map(catalog.map(x => [x.symbol, x.name])); this.now = now
    this.evidenceSource = evidenceSource
    ensure(typeof evidenceSource === 'function', 'invalid_evidence_source')
    if (path !== ':memory:' && existsSync(path)) ensure(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'database_must_be_normal_file')
    this.db = new DatabaseSync(path)
    // VACUUM INTO is SQLite's consistent snapshot, including committed WAL pages.
    // Reserve a unique sibling backup before touching an existing pre-v4 schema.
    const oldSchema = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_comments'").get()
    const version = this.db.prepare('PRAGMA user_version').get().user_version
    if (version > 4) { this.db.close(); ensure(false, 'unsupported_database_schema') }
    this.migrationBackup = null
    if (oldSchema && version < 4 && path !== ':memory:') {
      const directory = realpathSync(dirname(resolve(path)))
      const backupPath = resolve(directory, `community-pre-v4-${Date.now()}-${randomUUID()}.sqlite`)
      const part = relative(directory, backupPath)
      ensure(part && !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep) && !existsSync(backupPath), 'unsafe_migration_backup')
      try { this.db.prepare('VACUUM INTO ?').run(backupPath); chmodSync(backupPath, 0o600); this.migrationBackup = backupPath }
      catch (error) { this.db.close(); throw error }
    }
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
    this.migrate()
    // A restart never carries an earlier administrator's auto-publish consent.
    this.db.prepare("UPDATE community_policy SET publish_mode='review_only' WHERE id=1").run()
  }
  migrate() {
    this.tx(() => {
      const add = (table, fields) => {
        const columns = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name))
        for (const [name, type] of Object.entries(fields)) if (!columns.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
      }
      add('community_comments', { message_type: "TEXT NOT NULL DEFAULT 'comment'" })
      add('community_jobs', { message_type: "TEXT NOT NULL DEFAULT 'comment'", snapshot_id: 'TEXT', batch_id: 'TEXT', context_json: 'TEXT', previous_opinion_id: 'TEXT', requested_model: 'TEXT', reported_model: 'TEXT', generated_at: 'INTEGER', output_json: 'TEXT', finish_ack: 'TEXT', trigger_actor: 'TEXT', reply_to: 'TEXT', requires_review: 'INTEGER NOT NULL DEFAULT 0' })
      add('community_policy', { user_symbol_attempts: 'INTEGER NOT NULL DEFAULT 20', symbol_attempts: 'INTEGER NOT NULL DEFAULT 100', max_concurrent: 'INTEGER NOT NULL DEFAULT 3', max_followups: 'INTEGER NOT NULL DEFAULT 4', max_agent_interaction: 'INTEGER NOT NULL DEFAULT 2' })
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS community_context_snapshots (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, created INTEGER NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS community_opinion_batches (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, symbol TEXT NOT NULL, interaction TEXT NOT NULL, snapshot_id TEXT NOT NULL, created INTEGER NOT NULL, followup_started INTEGER NOT NULL DEFAULT 0, cancelled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS community_opinion_requests (id TEXT PRIMARY KEY, digest TEXT NOT NULL, response TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS community_scope_usage (scope TEXT NOT NULL, key TEXT NOT NULL, symbol TEXT NOT NULL, day TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope,key,day));
        CREATE TABLE IF NOT EXISTS community_generation_attempts (job_id TEXT NOT NULL, attempt INTEGER NOT NULL, started INTEGER NOT NULL, completed INTEGER, outcome TEXT NOT NULL, reason TEXT, PRIMARY KEY(job_id,attempt));
        CREATE TABLE IF NOT EXISTS community_migrations (version INTEGER PRIMARY KEY, applied INTEGER NOT NULL, backup_path TEXT);
        CREATE INDEX IF NOT EXISTS community_opinions_latest ON community_comments(symbol,author,message_type,seq);
        CREATE INDEX IF NOT EXISTS community_jobs_opinions ON community_jobs(symbol,agent,message_type,state);
        UPDATE community_comments SET message_type='reply' WHERE parent IS NOT NULL AND message_type='comment';
        PRAGMA user_version=4;
      `)
      this.db.prepare('INSERT OR IGNORE INTO community_migrations(version,applied,backup_path) VALUES(4,?,?)').run(this.now(), this.migrationBackup)
    })
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
      limits: Object.fromEntries(Object.entries(LIMIT_COLUMNS).map(([key, [column]]) => [key, policy[column]])),
      disabledSymbols: this.db.prepare('SELECT symbol FROM community_symbol_settings WHERE enabled=0').all().map(x => x.symbol) }
  }
  configure(input) {
    const { paused, agent, enabled, symbol, mode } = input
    this.tx(() => {
      if (paused !== undefined) { ensure(typeof paused === 'boolean', 'invalid_setting'); this.db.prepare('UPDATE community_settings SET paused=? WHERE id=1').run(+paused) }
      if (agent !== undefined) { ensure(AGENTS[agent] && typeof enabled === 'boolean', 'invalid_agent'); this.db.prepare('UPDATE community_agents SET enabled=? WHERE id=?').run(+enabled, agent) }
      if (symbol !== undefined) {
        ensure(this.catalog.has(symbol) && typeof enabled === 'boolean', 'invalid_symbol_setting')
        this.db.prepare('INSERT INTO community_symbol_settings(symbol,enabled) VALUES(?,?) ON CONFLICT(symbol) DO UPDATE SET enabled=excluded.enabled').run(symbol, +enabled)
        if (!enabled) {
          this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='symbol_disabled' WHERE symbol=? AND state IN ('queued','running','awaiting_approval')").run(symbol)
          this.db.prepare('UPDATE community_opinion_batches SET cancelled=1 WHERE symbol=?').run(symbol)
        }
      }
      if (mode !== undefined) {
        ensure(['review_only','auto'].includes(mode), 'invalid_mode')
        this.db.prepare('UPDATE community_policy SET publish_mode=? WHERE id=1').run(mode)
      }
      for (const [key, [column, minimum, maximum]] of Object.entries(LIMIT_COLUMNS)) {
        const value = input[key] ?? input.limits?.[key]
        if (value !== undefined) {
          ensure(Number.isInteger(value) && value >= minimum && value <= maximum, 'invalid_daily_limit')
          this.db.prepare(`UPDATE community_policy SET ${column}=? WHERE id=1`).run(value)
        }
      }
      // A normal stop invalidates in-flight work; it must not publish after a later restart.
      if (paused === true) {
        this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='admin_paused' WHERE state IN ('queued','running','awaiting_approval')").run()
        this.db.prepare('UPDATE community_opinion_batches SET cancelled=1').run()
      }
      if (agent && enabled === false) this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='agent_disabled' WHERE agent=? AND state IN ('queued','running','awaiting_approval')").run(agent)
      this.audit('configure', JSON.stringify(input))
      for (const row of this.db.prepare("SELECT DISTINCT interaction FROM community_jobs WHERE state IN ('queued','running','awaiting_approval')").all()) this.enforceFollowupLimits(row.interaction)
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
  captureSnapshot(symbol) {
    const supplied = this.evidenceSource(symbol)
    ensure(!supplied || typeof supplied.then !== 'function', 'evidence_source_must_be_synchronous')
    const value = supplied ? parse(json(supplied)) : {}
    ensure(!value.symbol || value.symbol === symbol, 'snapshot_symbol_mismatch')
    const suppliedEvidence = value.evidence || []
    ensure(Array.isArray(suppliedEvidence) && suppliedEvidence.length <= 100, 'invalid_evidence_snapshot')
    const evidence = suppliedEvidence.map(item => {
      ensure(item && typeof item === 'object' && !Array.isArray(item), 'invalid_evidence_snapshot')
      return Object.fromEntries(EVIDENCE_FIELDS.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]]))
    })
    const ids = new Set()
    for (const item of evidence) {
      ensure(item && item.symbol === symbol && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 160 && !ids.has(item.id), 'invalid_evidence_snapshot')
      ids.add(item.id)
    }
    const snapshot = { id: randomUUID(), symbol, createdAt: new Date(this.now()).toISOString(), dataAsOf: value.dataAsOf || null, evidence }
    const encoded = json(snapshot)
    ensure(Buffer.byteLength(encoded) <= 32768, 'evidence_snapshot_too_large')
    this.db.prepare('INSERT INTO community_context_snapshots(id,symbol,created,value) VALUES(?,?,?,?)').run(snapshot.id, symbol, this.now(), encoded)
    return snapshot
  }
  snapshot(id) { return id ? parse(this.db.prepare('SELECT value FROM community_context_snapshots WHERE id=?').get(id)?.value) : null }
  previousOpinion(symbol, agent) {
    return this.db.prepare("SELECT * FROM community_comments WHERE symbol=? AND author=? AND kind='ai' AND message_type='opinion' AND hidden=0 ORDER BY seq DESC LIMIT 1").get(symbol, agent) || null
  }
  contextFor(job) {
    const frozen = parse(job.context_json)
    const recent = frozen || this.db.prepare('SELECT * FROM community_comments WHERE symbol=? AND hidden=0 AND allow_ai=1 ORDER BY seq DESC LIMIT 20').all(job.symbol)
    const own = frozen ? [] : this.db.prepare("SELECT * FROM community_comments WHERE symbol=? AND kind='ai' AND author=? AND hidden=0 AND allow_ai=1 ORDER BY seq DESC LIMIT 3").all(job.symbol, job.agent)
    const ids = [...recent, ...own].map(row => row.id)
    ids.push(...[job.source, job.parent, job.previous_opinion_id].filter(Boolean))
    const rows = [...new Set(ids)].map(id => this.db.prepare('SELECT * FROM community_comments WHERE id=? AND symbol=? AND hidden=0 AND allow_ai=1').get(id, job.symbol)).filter(Boolean)
    const convert = row => ({ id: row.id, kind: row.kind, agent: row.kind === 'ai' ? row.author : null, messageType: row.message_type, text: row.body })
    const required = new Set([job.source, job.parent, job.previous_opinion_id, ...own.map(row => row.id)].filter(Boolean))
    const kept = rows.filter(row => required.has(row.id))
    let bytes = Buffer.byteLength(json(kept.map(convert)))
    ensure(bytes <= 24576, 'critical_context_too_large')
    for (const row of rows.filter(row => !required.has(row.id)).sort((a,b) => b.seq-a.seq)) {
      const size = Buffer.byteLength(json(convert(row))) + 1
      if (bytes + size <= 24576) { kept.push(row); bytes += size }
    }
    return kept.sort((a,b) => a.seq-b.seq).map(convert)
  }
  validationContext(job) {
    const context = this.contextFor(job), snapshot = this.snapshot(job.snapshot_id)
    return { symbol: job.symbol, messageType: job.message_type, source: job.source, parent: job.parent, context, allowedReplyIds: context.map(row => row.id), snapshot, evidence: snapshot?.evidence || [], previousOpinionId: job.previous_opinion_id || null }
  }
  publicComment(row) {
    if (!row) return null
    const job = row.job_id ? this.db.prepare('SELECT * FROM community_jobs WHERE id=?').get(row.job_id) : null
    const output = parse(job?.output_json, {})
    const snapshot = this.snapshot(job?.snapshot_id)
    const meta = job ? { provider: job.agent, requestedModel: job.requested_model || job.model || null, reportedModel: job.reported_model || null,
      model: job.requested_model || job.model || null, cliVersion: job.cli_version, cli_version: job.cli_version,
      generatedAt: job.generated_at ? new Date(job.generated_at).toISOString() : null, contextSnapshotId: job.snapshot_id || null,
      dataAsOf: snapshot?.dataAsOf || null, evidenceIds: output.evidence_ids || output.evidenceIds || [], previousOpinionId: job.previous_opinion_id || null,
      evidence: (snapshot?.evidence || []).filter(item => (output.evidence_ids || output.evidenceIds || []).includes(item.id)),
      promptVersion: job.prompt_version, prompt_version: job.prompt_version } : null
    return { id: row.id, seq: row.seq, symbol: row.symbol, parent: row.parent, kind: row.kind,
      messageType: row.message_type, interactionId: row.interaction,
      name: row.kind === 'ai' ? AGENTS[row.author].name : (this.resolveHumanName?.(row.author) || '로컬 사용자'), agent: row.kind === 'ai' ? row.author : null,
      text: row.hidden ? '' : row.body, hidden: !!row.hidden, allowAi: !!row.allow_ai,
      createdAt: new Date(row.created).toISOString(), depth: row.depth, metadata: meta }
  }
  comments(symbol, before = Number.MAX_SAFE_INTEGER) {
    ensure(this.catalog.has(symbol), 'unknown_symbol', 404)
    ensure(Number.isSafeInteger(before) && before > 0, 'invalid_cursor')
    const rows = this.db.prepare('SELECT * FROM community_comments WHERE symbol=? AND seq<? ORDER BY seq DESC LIMIT 50').all(symbol, before)
    const counts = this.db.prepare('SELECT kind,COUNT(*) AS count FROM community_comments WHERE symbol=? AND hidden=0 GROUP BY kind').all(symbol)
    const settings = this.settings()
    const opinions = Object.fromEntries(Object.keys(AGENTS).map(agent => {
      const history = this.db.prepare("SELECT * FROM community_comments WHERE symbol=? AND author=? AND kind='ai' AND message_type='opinion' AND hidden=0 ORDER BY seq DESC LIMIT 50").all(symbol, agent).map(row => this.publicComment(row))
      const job = this.db.prepare("SELECT state,reason FROM community_jobs WHERE symbol=? AND agent=? AND message_type='opinion' ORDER BY created DESC,rowid DESC LIMIT 1").get(symbol, agent)
      const stopped = settings.paused || settings.disabledSymbols.includes(symbol) || !settings.agents.find(row => row.id === agent)?.enabled
      return [agent, { latest: history[0] || null, history, state: stopped ? { status: 'disabled', reason: settings.paused ? 'admin_paused' : settings.disabledSymbols.includes(symbol) ? 'symbol_disabled' : 'agent_disabled' } : { status: job?.state || (history.length ? 'published' : 'not-generated'), reason: job?.reason || null } }]
    }))
    return { comments: rows.reverse().map(x => this.publicComment(x)), opinions, counts: Object.fromEntries(counts.map(x => [x.kind, x.count])), nextBefore: rows.length === 50 ? rows[0].seq : null }
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
      const id = randomUUID(), interaction = p?.interaction || randomUUID(), now = this.now()
      this.db.prepare("INSERT INTO community_comments(id,symbol,parent,kind,author,body,allow_ai,created,interaction,depth,message_type) VALUES(?,?,?,'human',?,?,?,?,?,?,?)").run(id, symbol, parent, actor, content, +allowAi, now, interaction, p ? p.depth + 1 : 0, parent ? 'reply' : 'comment')
      this.db.prepare('INSERT INTO community_requests(key,session,digest,comment_id) VALUES(?,?,?,?)').run(key, actor, digest, id)
      if (allowAi) this.schedule({ symbol, parent: id, source: id, interaction, preferred: p?.kind === 'ai' ? p.author : null, triggerActor: actor })
      return this.publicComment(this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(id))
    }); this.notify(symbol); return result
  }
  schedule({ symbol, parent = null, source = null, interaction, preferred = null, snapshotId = null, batchId = null, triggerActor = null }) {
    if (this.settings().paused || this.settings().disabledSymbols.includes(symbol)) return null
    const jobs = this.db.prepare('SELECT agent,state FROM community_jobs WHERE interaction=?').all(interaction)
    if (!source && jobs.some(x => !TERMINAL.includes(x.state))) return null
    const p = parent ? this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(parent) : null
    if (p?.hidden) return null
    const limits = this.settings().limits
    const aiDepth = this.db.prepare("SELECT COUNT(*) AS n FROM community_comments WHERE interaction=? AND kind='ai' AND message_type!='opinion'").get(interaction).n
    if (aiDepth >= limits.maxFollowups) return null
    const followups = this.db.prepare("SELECT agent FROM community_jobs WHERE interaction=? AND message_type!='opinion'").all(interaction)
    if (followups.length >= 6) return null
    const candidates = this.settings().agents.filter(a => a.enabled && followups.filter(j => j.agent === a.id).length < limits.maxAgentPerInteraction && !(p?.kind === 'ai' && p.author === a.id))
    if (!candidates.length) return null
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM community_jobs').get().n
    const agent = candidates.find(a => a.id === preferred)?.id || candidates[total % candidates.length].id
    const id = randomUUID(), now = this.now()
    const batch = this.db.prepare('SELECT id,snapshot_id FROM community_opinion_batches WHERE interaction=? AND cancelled=0').get(interaction)
    batchId ||= batch?.id || null
    snapshotId ||= batch?.snapshot_id || this.captureSnapshot(symbol).id
    const previous = this.previousOpinion(symbol, agent)
    this.db.prepare("INSERT INTO community_jobs(id,dedupe,symbol,parent,source,interaction,agent,state,created,expires,ready,message_type,snapshot_id,batch_id,trigger_actor,previous_opinion_id) VALUES(?,?,?,?,?,?,?,'queued',?,?,?,?,?,?,?,?)").run(id, `${interaction}:${jobs.length}`, symbol, parent, source, interaction, agent, now, now + DAY, now, parent ? 'reply' : 'comment', snapshotId, batchId, triggerActor, previous?.id || null)
    return id
  }
  request(symbol) {
    ensure(this.catalog.has(symbol), 'unknown_symbol', 404)
    const id = this.tx(() => this.schedule({ symbol, interaction: randomUUID() }))
    this.audit('manual_request', symbol); this.notify(symbol); return { jobId: id }
  }
  requestOpinions({ symbols, all = false, agents = Object.keys(AGENTS), requestId } = {}) {
    ensure(typeof requestId === 'string' && /^[a-zA-Z0-9-]{16,128}$/.test(requestId), 'invalid_request')
    ensure(typeof all === 'boolean' && (all ? symbols === undefined : Array.isArray(symbols) && symbols.length > 0), 'invalid_symbols')
    const selected = [...new Set(all ? [...this.catalog.keys()] : symbols)].sort()
    ensure(selected.length <= 500 && selected.every(symbol => this.catalog.has(symbol)), 'unknown_symbol', 404)
    ensure(Array.isArray(agents) && agents.length > 0 && agents.length <= 3 && new Set(agents).size === agents.length && agents.every(agent => Object.hasOwn(AGENTS, agent)), 'invalid_agents')
    agents = [...agents].sort()
    const digest = hash(json({ symbols: selected, agents }))
    const result = this.tx(() => {
      const existing = this.db.prepare('SELECT * FROM community_opinion_requests WHERE id=?').get(requestId)
      if (existing) { ensure(existing.digest === digest, 'idempotency_conflict', 409); return parse(existing.response) }
      const result = { requestId, batchIds: [], jobIds: [], states: [] }, settings = this.settings()
      for (const symbol of selected) {
        const snapshot = this.captureSnapshot(symbol), batchId = randomUUID(), interaction = randomUUID(), now = this.now()
        // A newer version invalidates older unposted initial opinions as a cohort.
        for (const agent of agents) {
          const old = this.db.prepare("SELECT DISTINCT batch_id FROM community_jobs WHERE symbol=? AND agent=? AND message_type='opinion' AND state IN ('queued','running','awaiting_approval')").all(symbol, agent)
          for (const row of old) if (row.batch_id) {
            this.db.prepare('UPDATE community_opinion_batches SET cancelled=1 WHERE id=?').run(row.batch_id)
            this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='opinion_superseded',draft=NULL WHERE batch_id=? AND state IN ('queued','running','awaiting_approval')").run(row.batch_id)
          }
        }
        this.db.prepare('INSERT INTO community_opinion_batches(id,request_id,symbol,interaction,snapshot_id,created) VALUES(?,?,?,?,?,?)').run(batchId, requestId, symbol, interaction, snapshot.id, now)
        result.batchIds.push(batchId)
        for (const agent of agents) {
          const id = randomUUID(), previous = this.previousOpinion(symbol, agent)
          const reason = settings.paused ? 'admin_paused' : settings.disabledSymbols.includes(symbol) ? 'symbol_disabled' : !settings.agents.find(row => row.id === agent)?.enabled ? 'agent_disabled' : !snapshot.evidence.length ? 'insufficient_evidence' : null
          const state = reason ? 'blocked' : 'queued'
          const context = this.contextFor({ symbol, agent, previous_opinion_id: previous?.id })
          this.db.prepare("INSERT INTO community_jobs(id,dedupe,symbol,interaction,agent,state,created,expires,ready,message_type,snapshot_id,batch_id,context_json,previous_opinion_id,reason) VALUES(?,?,?,?,?,?,?,?,?,'opinion',?,?,?,?,?)").run(id, `opinion:${requestId}:${symbol}:${agent}`, symbol, interaction, agent, state, now, now + DAY, now, snapshot.id, batchId, json(context), previous?.id || null, reason)
          result.jobIds.push(id); result.states.push({ symbol, agent, state, reason })
        }
      }
      this.db.prepare('INSERT INTO community_opinion_requests(id,digest,response) VALUES(?,?,?)').run(requestId, digest, json(result))
      this.audit('opinion_request', requestId)
      return result
    })
    this.notify(); return result
  }
  releaseBatch(batchId) {
    if (!batchId) return
    const batch = this.db.prepare('SELECT * FROM community_opinion_batches WHERE id=?').get(batchId)
    if (!batch || batch.cancelled || batch.followup_started) return
    if (batch.created + DAY <= this.now()) {
      this.db.prepare('UPDATE community_opinion_batches SET cancelled=1,followup_started=1 WHERE id=?').run(batchId)
      return
    }
    const initial = this.db.prepare("SELECT state FROM community_jobs WHERE batch_id=? AND message_type='opinion'").all(batchId)
    if (!initial.length || initial.some(job => !TERMINAL.includes(job.state))) return
    this.db.prepare('UPDATE community_opinion_batches SET followup_started=1 WHERE id=?').run(batchId)
    const parent = this.db.prepare("SELECT c.* FROM community_comments c JOIN community_jobs j ON j.id=c.job_id WHERE j.batch_id=? AND c.message_type='opinion' AND c.hidden=0 ORDER BY c.seq DESC LIMIT 1").get(batchId)
    if (parent) this.schedule({ symbol: batch.symbol, parent: parent.id, interaction: batch.interaction, snapshotId: batch.snapshot_id, batchId })
  }
  recover() {
    const now = this.now()
    this.db.prepare("UPDATE community_jobs SET state='expired',reason='expired' WHERE expires<=? AND state IN ('queued','running','awaiting_approval')").run(now)
    this.db.prepare("UPDATE community_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END, ready=?,lease=NULL,lease_until=NULL,reason='lease_expired' WHERE state='running' AND lease_until<=?").run(now, now)
    this.db.prepare("UPDATE community_generation_attempts SET outcome='unknown',completed=?,reason='lease_expired' WHERE outcome='running' AND job_id IN (SELECT id FROM community_jobs WHERE reason='lease_expired')").run(now)
    for (const batch of this.db.prepare('SELECT id FROM community_opinion_batches WHERE cancelled=0 AND followup_started=0').all()) this.releaseBatch(batch.id)
  }
  runnable(job) {
    if (this.settings().paused || this.settings().disabledSymbols.includes(job.symbol) || !this.settings().agents.find(a => a.id === job.agent)?.enabled || job.expires <= this.now()) return false
    if (job.batch_id && this.db.prepare('SELECT cancelled FROM community_opinion_batches WHERE id=?').get(job.batch_id)?.cancelled) return false
    if (job.message_type !== 'opinion') {
      const limits = this.settings().limits
      const posted = this.db.prepare("SELECT author FROM community_comments WHERE interaction=? AND kind='ai' AND message_type!='opinion'").all(job.interaction)
      if (posted.length >= limits.maxFollowups || posted.filter(row => row.author === job.agent).length >= limits.maxAgentPerInteraction) return false
    }
    for (const id of [job.source, job.parent, job.reply_to, job.previous_opinion_id].filter(Boolean)) {
      const c = this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(id)
      if (!c || c.hidden || !c.allow_ai || c.symbol !== job.symbol) return false
    }
    if (parse(job.context_json, []).some(row => {
      const current = this.db.prepare('SELECT hidden,allow_ai,symbol FROM community_comments WHERE id=?').get(row.id)
      return !current || current.hidden || !current.allow_ai || current.symbol !== job.symbol
    })) return false
    return true
  }
  enforceFollowupLimits(interaction) {
    const limits = this.settings().limits
    const posted = this.db.prepare("SELECT author FROM community_comments WHERE interaction=? AND kind='ai' AND message_type!='opinion'").all(interaction)
    if (posted.length >= limits.maxFollowups) this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='followup_limit',draft=NULL WHERE interaction=? AND message_type!='opinion' AND state IN ('queued','running','awaiting_approval')").run(interaction)
    for (const agent of Object.keys(AGENTS)) if (posted.filter(row => row.author === agent).length >= limits.maxAgentPerInteraction) this.db.prepare("UPDATE community_jobs SET state='cancelled',reason='agent_interaction_limit',draft=NULL WHERE interaction=? AND agent=? AND message_type!='opinion' AND state IN ('queued','running','awaiting_approval')").run(interaction, agent)
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
        const limits = this.settings().limits
        if (row.message_type !== 'opinion' && this.db.prepare("SELECT 1 FROM community_jobs WHERE interaction=? AND message_type='opinion' AND state IN ('queued','running','awaiting_approval')").get(row.interaction)) continue
        if (this.db.prepare("SELECT COUNT(*) AS n FROM community_jobs WHERE state='running'").get().n >= limits.maxConcurrent) break
        if (this.db.prepare("SELECT 1 FROM community_jobs WHERE state='running' AND (agent=? OR symbol=? OR interaction=?)").get(row.agent, row.symbol, row.interaction)) continue
        this.db.prepare('INSERT OR IGNORE INTO community_usage(agent,day) VALUES(?,?)').run(row.agent, day)
        const usage = this.db.prepare('SELECT * FROM community_usage WHERE agent=? AND day=?').get(row.agent, day)
        let reason = usage.attempts >= limits.dailyAttempts || usage.published >= limits.dailyPosts ? 'daily_limit' : null
        const symbolUsage = this.db.prepare("SELECT attempts FROM community_scope_usage WHERE scope='symbol' AND key=? AND day=?").get(row.symbol, day)?.attempts || 0
        const userKey = row.trigger_actor ? `${row.trigger_actor}:${row.symbol}` : null
        const userUsage = userKey ? this.db.prepare("SELECT attempts FROM community_scope_usage WHERE scope='user-symbol' AND key=? AND day=?").get(userKey, day)?.attempts || 0 : 0
        if (symbolUsage >= limits.symbolDailyAttempts) reason = 'symbol_daily_limit'
        if (userKey && userUsage >= limits.userSymbolDailyAttempts) reason = 'user_symbol_daily_limit'
        if (reason) { this.db.prepare("UPDATE community_jobs SET state='blocked',reason=? WHERE id=?").run(reason, row.id); this.releaseBatch(row.batch_id); continue }
        const lease = randomUUID()
        this.db.prepare("UPDATE community_jobs SET state='running',lease=?,lease_until=?,attempts=attempts+1,reason=NULL WHERE id=?").run(lease, now + 180000, row.id)
        this.db.prepare('UPDATE community_usage SET attempts=attempts+1 WHERE agent=? AND day=?').run(row.agent, day)
        this.db.prepare("INSERT INTO community_generation_attempts(job_id,attempt,started,outcome) VALUES(?,?,?,'running')").run(row.id, row.attempts + 1, now)
        for (const [scope, key] of [['symbol', row.symbol], ...(userKey ? [['user-symbol', userKey]] : [])]) this.db.prepare('INSERT INTO community_scope_usage(scope,key,symbol,day,attempts) VALUES(?,?,?,?,1) ON CONFLICT(scope,key,day) DO UPDATE SET attempts=attempts+1').run(scope, key, row.symbol, day)
        const context = this.contextFor(row)
        if (!row.context_json) this.db.prepare('UPDATE community_jobs SET context_json=? WHERE id=?').run(json(context), row.id)
        return { job: { id: row.id, lease, agent: row.agent, symbol: row.symbol, company: this.catalog.get(row.symbol), messageType: row.message_type,
          source: row.source, parent: row.parent, interactionId: row.interaction, batchId: row.batch_id, context,
          ownPast: context.filter(item => item.agent === row.agent),
          contextTruncated: this.db.prepare('SELECT COUNT(*) AS n FROM community_comments WHERE symbol=? AND hidden=0 AND allow_ai=1').get(row.symbol).n > context.length,
          snapshot: this.snapshot(row.snapshot_id), previousOpinionId: row.previous_opinion_id || null }, nextDue: null }
      }
      const dues = this.db.prepare("SELECT agent,CASE WHEN state='running' THEN lease_until ELSE ready END AS due FROM community_jobs WHERE state IN ('queued','running')").all().filter(x => agents.includes(x.agent) && x.due > now)
      return { job: null, nextDue: dues.length ? Math.min(...dues.map(x => x.due)) : null }
    })
  }
  finish(input) {
    const id = input.jobId || input.id, lease = input.leaseToken || input.lease
    const { output, cliVersion } = input
    const requestedModel = input.requestedModel || input.model, reportedModel = input.reportedModel ?? null
    let accepted = false
    const result = this.tx(() => {
      const job = this.db.prepare('SELECT * FROM community_jobs WHERE id=?').get(id)
      ensure(job && job.lease === lease, 'stale_lease', 409)
      ensure(!input.provider || input.provider === job.agent, 'provider_mismatch')
      if (['awaiting_approval', 'published', 'skipped'].includes(job.state)) return input.jobId && job.finish_ack ? parse(job.finish_ack) : { state: job.state, ...(job.state === 'published' ? { commentId: this.db.prepare('SELECT id FROM community_comments WHERE job_id=?').get(id)?.id } : {}) }
      ensure(job.state === 'running' && job.lease_until > this.now(), 'stale_lease', 409)
      ensure(this.runnable(job), 'no_longer_eligible', 409)
      ensure(!input.provider || input.provider === job.agent, 'provider_mismatch')
      const valid = validateOutput(output, this.validationContext(job))
      ensure(typeof requestedModel === 'string' && requestedModel.length > 0 && requestedModel.length <= 120 && typeof cliVersion === 'string' && cliVersion.length > 0 && cliVersion.length <= 120, 'invalid_provenance')
      ensure(reportedModel === null || (typeof reportedModel === 'string' && reportedModel.length > 0 && reportedModel.length <= 120), 'invalid_provenance')
      ensure(reportedModel === null || reportedModel === requestedModel, 'reported_model_mismatch')
      const state = valid.action === 'skip' ? 'skipped' : 'awaiting_approval'
      const result = { state, jobId: id }
      this.db.prepare('UPDATE community_jobs SET state=?,draft=?,reason=?,model=?,requested_model=?,reported_model=?,cli_version=?,prompt_version=?,completed=?,generated_at=?,output_json=?,reply_to=?,requires_review=?,finish_ack=? WHERE id=?').run(state, valid.text, valid.requiresReview ? 'evidence_review_required' : valid.reason, requestedModel, requestedModel, reportedModel, cliVersion, PROMPT_VERSION, this.now(), this.now(), json(output), valid.replyTo || job.parent || null, +!!valid.requiresReview, json(result), id)
      this.db.prepare("UPDATE community_generation_attempts SET outcome='success',completed=? WHERE job_id=? AND attempt=?").run(this.now(), id, job.attempts)
      accepted = true
      this.audit(state === 'skipped' ? 'skip' : 'draft', id); return result
    })
    const job = this.db.prepare('SELECT * FROM community_jobs WHERE id=?').get(id)
    if (accepted && result.state === 'awaiting_approval' && this.settings().mode === 'auto' && !job.requires_review) {
      try {
        const comment = this.approve(id), published = { state: 'published', commentId: comment.id, jobId: id }
        this.db.prepare('UPDATE community_jobs SET finish_ack=? WHERE id=?').run(json(published), id)
        return published
      }
      catch (error) {
        // A stop, duplicate or budget race must not silently publish or force regeneration.
        this.audit('auto_publish_deferred', id)
        const deferred = { state: this.db.prepare('SELECT state FROM community_jobs WHERE id=?').get(id).state, reason: error.code || 'review_required', jobId: id }
        this.db.prepare('UPDATE community_jobs SET finish_ack=?,reason=?,requires_review=1 WHERE id=?').run(json(deferred), deferred.reason, id)
        return deferred
      }
    }
    if (accepted && TERMINAL.includes(result.state)) this.tx(() => this.releaseBatch(job.batch_id))
    return result
  }
  fail(input) {
    const id = input.jobId || input.id, lease = input.leaseToken || input.lease, retryable = input.retryable === true
    const code = /^[a-z][a-z0-9_]{0,79}$/.test(input.code || '') ? input.code : 'cli_failed'
    const result = this.tx(() => {
      const job = this.db.prepare('SELECT * FROM community_jobs WHERE id=?').get(id)
      ensure(job && job.state === 'running' && job.lease === lease && job.lease_until > this.now(), 'stale_lease', 409)
      const state = retryable && job.attempts < 3 ? 'queued' : 'blocked'
      const ready = this.now() + 1000 * 2 ** job.attempts
      this.db.prepare('UPDATE community_jobs SET state=?,reason=?,ready=?,lease=NULL,lease_until=NULL WHERE id=?').run(state, String(code).slice(0, 80), ready, id)
      this.db.prepare("UPDATE community_generation_attempts SET outcome='failure',completed=?,reason=? WHERE job_id=? AND attempt=?").run(this.now(), code, id, job.attempts)
      return { state, nextDue: state === 'queued' ? ready : null }
    }); this.tx(() => this.releaseBatch(this.db.prepare('SELECT batch_id FROM community_jobs WHERE id=?').get(id)?.batch_id)); this.notify(); return result
  }
  approve(id) {
    try {
    const result = this.tx(() => {
      const job = this.db.prepare('SELECT * FROM community_jobs WHERE id=?').get(id)
      ensure(job, 'unknown_job', 404)
      if (job.state === 'published') return this.publicComment(this.db.prepare('SELECT * FROM community_comments WHERE job_id=?').get(id))
      ensure(job.state === 'awaiting_approval', 'not_awaiting_approval', 409)
      ensure(this.runnable(job), 'no_longer_eligible', 409)
      const valid = validateOutput(parse(job.output_json, { action: 'reply', text: job.draft }), this.validationContext(job))
      const body = valid.text
      ensure(!this.db.prepare('SELECT 1 FROM community_comments WHERE symbol=? AND author=? AND body=? AND hidden=0 AND created>?').get(job.symbol, job.agent, body, this.now() - DAY), 'duplicate_comment', 409)
      const day = kstDay(this.now())
      this.db.prepare('INSERT OR IGNORE INTO community_usage(agent,day) VALUES(?,?)').run(job.agent, day)
      ensure(this.db.prepare('SELECT published FROM community_usage WHERE agent=? AND day=?').get(job.agent, day).published < this.settings().limits.dailyPosts, 'daily_limit', 429)
      const parentId = valid.replyTo || job.parent || null
      const parent = parentId ? this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(parentId) : null
      const commentId = randomUUID()
      this.db.prepare("INSERT INTO community_comments(id,symbol,parent,kind,author,body,allow_ai,created,interaction,depth,job_id,message_type) VALUES(?,?,?,'ai',?,?,1,?,?,?,?,?)").run(commentId, job.symbol, parentId, job.agent, body, this.now(), job.interaction, parent ? parent.depth + 1 : 0, id, job.message_type)
      this.db.prepare("UPDATE community_jobs SET state='published',completed=? WHERE id=?").run(this.now(), id)
      this.db.prepare('UPDATE community_usage SET published=published+1 WHERE agent=? AND day=?').run(job.agent, day)
      this.enforceFollowupLimits(job.interaction)
      this.audit('approve', id)
      if (job.message_type === 'opinion') this.releaseBatch(job.batch_id)
      else this.schedule({ symbol: job.symbol, parent: commentId, source: job.source, interaction: job.interaction, snapshotId: job.snapshot_id, batchId: job.batch_id, triggerActor: job.trigger_actor })
      return this.publicComment(this.db.prepare('SELECT * FROM community_comments WHERE id=?').get(commentId))
    }); this.notify(result.symbol); return result
    } catch (error) {
      if (error.code === 'duplicate_comment') this.audit('duplicate_rejected', id)
      throw error
    }
  }
  reject(id) {
    ensure(this.db.prepare("UPDATE community_jobs SET state='rejected',draft=NULL WHERE id=? AND state='awaiting_approval'").run(id).changes, 'not_awaiting_approval', 409)
    this.tx(() => this.releaseBatch(this.db.prepare('SELECT batch_id FROM community_jobs WHERE id=?').get(id)?.batch_id))
    this.audit('reject', id); return { state: 'rejected' }
  }
  hide(id) {
    this.tx(() => {
      ensure(this.db.prepare('UPDATE community_comments SET hidden=1 WHERE id=?').run(id).changes, 'unknown_comment', 404)
      this.db.prepare("UPDATE community_jobs SET state='cancelled',draft=NULL,reason='context_hidden' WHERE (parent=? OR source=? OR previous_opinion_id=? OR reply_to=? OR EXISTS (SELECT 1 FROM json_each(COALESCE(community_jobs.context_json,'[]')) WHERE json_extract(value,'$.id')=?)) AND state IN ('queued','running','awaiting_approval')").run(id, id, id, id, id)
      this.audit('hide', id)
    }); this.notify(); return { hidden: true }
  }
  touchWorker(id, state = 'connected') {
    ensure(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id), 'invalid_worker_id')
    this.db.prepare('DELETE FROM community_workers WHERE last_seen<?').run(this.now() - DAY)
    this.db.prepare('INSERT INTO community_workers(id,last_seen,state) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,state=excluded.state').run(id, this.now(), state)
  }
  admin() {
    this.tx(() => this.recover())
    const day = kstDay(this.now())
    const attempts = this.db.prepare('SELECT outcome,COUNT(*) AS count FROM community_generation_attempts GROUP BY outcome').all()
    const attemptCounts = Object.fromEntries(attempts.map(row => [row.outcome, row.count]))
    const known = (attemptCounts.success || 0) + (attemptCounts.failure || 0)
    const humanReplies = this.db.prepare("SELECT COUNT(*) AS n FROM community_comments c JOIN community_comments p ON p.id=c.parent WHERE c.kind='human' AND p.kind='ai' AND c.hidden=0 AND p.hidden=0").get().n
    const aiMessages = this.db.prepare("SELECT COUNT(*) AS n FROM community_comments WHERE kind='ai' AND hidden=0").get().n
    const observed = this.db.prepare('SELECT COUNT(*) AS count,AVG(completed-created) AS averageMs,MAX(completed-created) AS maximumMs FROM community_jobs WHERE completed IS NOT NULL').get()
    const pending = this.db.prepare("SELECT COUNT(*) AS count,MAX(?-created) AS oldestAgeMs FROM community_jobs WHERE state='queued'").get(this.now())
    return { ...this.settings(), workers: this.db.prepare('SELECT * FROM community_workers ORDER BY last_seen DESC LIMIT 10').all(),
      jobs: this.db.prepare('SELECT id,symbol,agent,state,draft,reason,model,requested_model,reported_model,cli_version,created,attempts,message_type,batch_id,snapshot_id FROM community_jobs ORDER BY created DESC,rowid DESC LIMIT 100').all(),
      usage: { agents: this.db.prepare('SELECT agent,day,attempts,published FROM community_usage WHERE day=?').all(day),
        symbols: this.db.prepare("SELECT symbol,day,attempts FROM community_scope_usage WHERE scope='symbol' AND day=?").all(day),
        userSymbols: this.db.prepare("SELECT key AS actorSymbolHash,symbol,day,attempts FROM community_scope_usage WHERE scope='user-symbol' AND day=?").all(day) },
      metrics: { humanRepliesToAi: humanReplies, visibleAiMessages: aiMessages, humanReplyRatio: aiMessages ? humanReplies / aiMessages : null,
        humanReplyRatioDefinition: 'visible human replies whose direct parent is a visible AI message / visible AI messages; AI-to-AI excluded',
        generationAttempts: attemptCounts, generationFailureRate: known ? (attemptCounts.failure || 0) / known : null,
        generationFailureRateDefinition: 'known failed attempts / known completed attempts; running and lost-lease outcomes excluded',
        queueToResult: observed, queued: pending, approvalRejections: this.db.prepare("SELECT COUNT(*) AS n FROM community_audit WHERE action='reject'").get().n,
        approvalRejectionReasons: null, reportReasons: null, repeatedPhraseRate: null,
        duplicateRejections: this.db.prepare("SELECT COUNT(*) AS n FROM community_audit WHERE action='duplicate_rejected'").get().n,
        measurementSince: new Date(this.db.prepare('SELECT applied FROM community_migrations WHERE version=4').get().applied).toISOString(),
        legacyAttemptsUnclassified: Math.max(0, this.db.prepare('SELECT COALESCE(SUM(attempts),0) AS n FROM community_usage').get().n - Object.values(attemptCounts).reduce((sum, value) => sum + value, 0)),
        uncollected: ['approvalRejectionReasons', 'reportReasons', 'repeatedPhraseRate'] } }
  }
}
