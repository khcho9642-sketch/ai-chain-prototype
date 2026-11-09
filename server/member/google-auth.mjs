import { createRemoteJWKSet, jwtVerify } from 'jose'

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 3600000 })
const SESSION_SECONDS = 7 * 24 * 60 * 60
const NONCE_SECONDS = 10 * 60
const MAX_BODY_BYTES = 16384
const encoder = new TextEncoder()
class AuthError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}
function ensure(condition, code, status = 400) { if (!condition) throw new AuthError(code, status) }
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('')
export async function hashToken(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), x => x.toString(16).padStart(2, '0')).join('')
}
function configuration(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.AUTH_ORIGIN || !env.MEMBER_DB) return null
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID)) return null
  let url
  try { url = new URL(env.AUTH_ORIGIN) } catch { return null }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
  const local = env.AUTH_ALLOW_LOCAL_HTTP === '1' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!local && url.protocol !== 'https:') return null
  return { origin: url.origin, clientId: env.GOOGLE_CLIENT_ID, secure: !local,
    sessionCookie: local ? 'ai_chain_dev_session' : '__Host-ai_chain_session',
    nonceCookie: local ? 'ai_chain_dev_nonce' : '__Host-ai_chain_nonce' }
}
function response(status, value, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin, Cookie' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(value), { status, headers })
}
function cookie(config, name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure ? '; Secure' : ''}`
}
function tokenCookie(request, name) {
  const matches = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${name}=`))
  if (matches.length !== 1) return ''
  const value = matches[0].slice(name.length + 1)
  return /^[a-f0-9]{64}$/.test(value) ? value : ''
}
function checkOrigin(request, config, requireOrigin = false) {
  ensure(new URL(request.url).origin === config.origin, 'invalid_origin', 403)
  const origin = request.headers.get('origin')
  ensure(!requireOrigin || origin === config.origin, 'invalid_origin', 403)
  ensure(!origin || origin === config.origin, 'invalid_origin', 403)
  const fetchSite = request.headers.get('sec-fetch-site')
  ensure(!fetchSite || ['same-origin', 'none'].includes(fetchSite), 'invalid_origin', 403)
}
async function readJson(request) {
  ensure((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === 'application/json', 'json_required', 415)
  const length = Number(request.headers.get('content-length'))
  ensure(!length || length <= MAX_BODY_BYTES, 'body_too_large', 413)
  const reader = request.body?.getReader()
  ensure(reader, 'invalid_body')
  const chunks = []; let size = 0
  const deadline = Date.now() + 10000
  try {
    for (;;) {
      let timer
      let next
      try {
        next = await Promise.race([reader.read(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new AuthError('request_timeout', 408)), Math.max(1, deadline - Date.now()))
        })])
      } finally { clearTimeout(timer) }
      const { value, done } = next
      if (done) break
      size += value.byteLength
      ensure(size <= MAX_BODY_BYTES, 'body_too_large', 413)
      chunks.push(value)
    }
  } catch (error) { reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let input
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new AuthError('invalid_json') }
  ensure(input && typeof input === 'object' && !Array.isArray(input), 'invalid_body')
  return input
}
async function rateLimit(db, request, action, now, max) {
  // Cloudflare overwrites CF-Connecting-IP at its edge. The local adapter replaces it.
  const address = request.headers.get('cf-connecting-ip') || 'local'
  const key = `${action}:${await hashToken(`member-auth:${address}`)}`
  const row = await db.prepare(`INSERT INTO member_rate_limits(key,count,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count`).bind(key, now + NONCE_SECONDS * 1000, now, now).first()
  ensure(row && row.count <= max, 'rate_limited', 429)
}
export async function verifyGoogleToken(credential, clientId, nonce, { keyset = GOOGLE_KEYS, now = Date.now() } = {}) {
  ensure(typeof credential === 'string' && credential.length > 20 && credential.length <= 12000, 'invalid_google_token', 401)
  let payload
  try {
    ({ payload } = await jwtVerify(credential, keyset, {
      algorithms: ['RS256'], audience: clientId, issuer: ['https://accounts.google.com', 'accounts.google.com'],
      requiredClaims: ['sub', 'exp', 'iat', 'aud', 'iss'], currentDate: new Date(now), clockTolerance: 5, maxTokenAge: '2h',
    }))
  } catch (error) {
    if (['ERR_JWKS_TIMEOUT', 'ERR_JWKS_FETCH_FAILED'].includes(error.code) || error instanceof TypeError) throw new AuthError('google_unavailable', 503)
    throw new AuthError('invalid_google_token', 401)
  }
  ensure(typeof payload.sub === 'string' && payload.sub.length > 0 && payload.sub.length <= 255, 'invalid_google_token', 401)
  ensure(payload.nonce === nonce, 'invalid_nonce', 401)
  ensure(!payload.azp || payload.azp === clientId, 'invalid_google_token', 401)
  ensure(payload.email_verified === true && typeof payload.email === 'string' && payload.email.length > 3 && payload.email.length <= 320, 'unverified_google_email', 401)
  // Google identity stays internal; public membership uses the nickname chosen below.
  return { sub: payload.sub, email: payload.email }
}
function publicUser(row) {
  return row ? { id: row.id, nickname: row.nickname, needsNickname: row.nickname === null } : null
}
function normalizeNickname(value) {
  ensure(typeof value === 'string', 'invalid_nickname')
  const nickname = value.normalize('NFC'), length = [...nickname].length
  ensure(length >= 2 && length <= 20 && /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*$/u.test(nickname), 'invalid_nickname')
  return nickname
}
async function currentUser(db, token, now) {
  if (!token) return null
  const row = await db.prepare(`SELECT u.id,u.nickname FROM member_sessions s JOIN member_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires>? AND u.disabled=0`).bind(await hashToken(token), now).first()
  return publicUser(row)
}

/** Independent Google membership API. It never calls paused market/community/worker services. */
export async function handleAuthRequest(request, env, options = {}) {
  try {
    const pathname = new URL(request.url).pathname
    const routes = { '/api/auth/config': 'GET', '/api/auth/nonce': 'GET', '/api/auth/me': 'GET', '/api/auth/google': 'POST', '/api/auth/logout': 'POST', '/api/auth/profile': 'POST', '/api/auth/withdraw': 'POST' }
    ensure(Object.hasOwn(routes, pathname), 'not_found', 404)
    if (request.method !== routes[pathname]) {
      const result = response(405, { error: 'method_not_allowed' }); result.headers.set('Allow', routes[pathname]); return result
    }
    const config = configuration(env)
    if (!config) return pathname === '/api/auth/config' ? response(200, { enabled: false, clientId: null }) : response(503, { error: 'auth_not_configured' })
    checkOrigin(request, config, request.method === 'POST')
    const db = env.MEMBER_DB, now = options.now ?? Date.now()
    if (pathname === '/api/auth/config') return response(200, { enabled: true, clientId: config.clientId })
    const session = tokenCookie(request, config.sessionCookie)
    if (pathname === '/api/auth/me') {
      const user = await currentUser(db, session, now)
      return response(200, { user }, session && !user ? [cookie(config, config.sessionCookie, '', 0)] : [])
    }
    if (pathname === '/api/auth/nonce') {
      await rateLimit(db, request, 'nonce', now, 20)
      const nonce = randomToken(), oldNonce = tokenCookie(request, config.nonceCookie)
      const statements = [
        db.prepare('DELETE FROM member_challenges WHERE expires<=?').bind(now),
        db.prepare('DELETE FROM member_rate_limits WHERE expires<=?').bind(now),
      ]
      if (oldNonce) statements.push(db.prepare('DELETE FROM member_challenges WHERE token_hash=?').bind(await hashToken(oldNonce)))
      statements.push(db.prepare('INSERT INTO member_challenges(token_hash,expires) VALUES(?,?)').bind(await hashToken(nonce), now + NONCE_SECONDS * 1000))
      await db.batch(statements)
      return response(200, { nonce }, [cookie(config, config.nonceCookie, nonce, NONCE_SECONDS)])
    }
    const input = await readJson(request)
    if (pathname === '/api/auth/logout') {
      if (session) await db.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(await hashToken(session)).run()
      const pendingNonce = tokenCookie(request, config.nonceCookie)
      if (pendingNonce) await db.prepare('DELETE FROM member_challenges WHERE token_hash=?').bind(await hashToken(pendingNonce)).run()
      return response(200, { loggedOut: true }, [cookie(config, config.sessionCookie, '', 0), cookie(config, config.nonceCookie, '', 0)])
    }
    if (pathname === '/api/auth/withdraw') {
      ensure(await currentUser(db, session, now), 'login_required', 401)
      ensure(input.confirmation === '탈퇴', 'invalid_confirmation')
      // The DELETE rechecks the live session and active account atomically. The
      // existing foreign key removes every session for this member, not others.
      const statements = [db.prepare(`DELETE FROM member_users WHERE disabled=0
        AND id=(SELECT user_id FROM member_sessions WHERE token_hash=? AND expires>?) RETURNING id`)
        .bind(await hashToken(session), now)]
      const pendingNonce = tokenCookie(request, config.nonceCookie)
      if (pendingNonce) statements.push(db.prepare('DELETE FROM member_challenges WHERE token_hash=?').bind(await hashToken(pendingNonce)))
      // A challenge cleanup failure must roll back account and session deletion.
      const results = await db.batch(statements)
      ensure(results[0].results?.length === 1, 'login_required', 401)
      return response(200, { ok: true }, [cookie(config, config.sessionCookie, '', 0), cookie(config, config.nonceCookie, '', 0)])
    }
    if (pathname === '/api/auth/profile') {
      ensure(await currentUser(db, session, now), 'login_required', 401)
      const nickname = normalizeNickname(input.nickname)
      await rateLimit(db, request, 'profile', now, 20)
      // Bind every nickname write to the live session and active member in the
      // same statement, including changes after onboarding and same-value retries.
      const saved = await db.prepare(`UPDATE member_users SET nickname=? WHERE disabled=0
        AND id=(SELECT user_id FROM member_sessions WHERE token_hash=? AND expires>?) RETURNING id,nickname`)
        .bind(nickname, await hashToken(session), now).first()
      ensure(saved, 'login_required', 401)
      return response(200, { user: publicUser(saved) })
    }
    await rateLimit(db, request, 'login', now, 20)
    const nonce = tokenCookie(request, config.nonceCookie)
    ensure(nonce, 'invalid_nonce', 401)
    const nonceHash = await hashToken(nonce)
    ensure(await db.prepare('SELECT token_hash FROM member_challenges WHERE token_hash=? AND expires>?').bind(nonceHash, now).first(), 'invalid_nonce', 401)
    const google = await verifyGoogleToken(input.credential, config.clientId, nonce, { keyset: options.keyset, now })
    // Single-use challenge consumption is atomic, including simultaneous submissions.
    ensure(await db.prepare('DELETE FROM member_challenges WHERE token_hash=? AND expires>? RETURNING token_hash').bind(nonceHash, now).first(), 'invalid_nonce', 401)
    const token = randomToken(), tokenHash = await hashToken(token), userId = crypto.randomUUID()
    const results = await db.batch([
      db.prepare(`INSERT INTO member_users(id,google_sub,name,email,created,last_login) VALUES(?,?,?,?,?,?)
        ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,last_login=excluded.last_login WHERE member_users.disabled=0`).bind(userId, google.sub, '회원', google.email, now, now),
      db.prepare(`INSERT INTO member_sessions(token_hash,user_id,created,expires)
        SELECT ?,id,?,? FROM member_users WHERE google_sub=? AND disabled=0 RETURNING user_id`).bind(tokenHash, now, now + SESSION_SECONDS * 1000, google.sub),
      db.prepare('DELETE FROM member_sessions WHERE expires<=?').bind(now),
      // Keep this login and the four newest other sessions, even when timestamps tie.
      db.prepare(`DELETE FROM member_sessions WHERE user_id=(SELECT id FROM member_users WHERE google_sub=?)
        AND token_hash<>? AND token_hash NOT IN (SELECT token_hash FROM member_sessions
          WHERE user_id=(SELECT id FROM member_users WHERE google_sub=?) AND token_hash<>?
          ORDER BY created DESC,token_hash DESC LIMIT 4)`).bind(google.sub, tokenHash, google.sub, tokenHash),
    ])
    ensure(results[1].results?.length === 1, 'account_disabled', 403)
    if (session) await db.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(await hashToken(session)).run()
    const user = await currentUser(db, token, now)
    ensure(user, 'session_unavailable', 503)
    return response(200, { user }, [cookie(config, config.sessionCookie, token, SESSION_SECONDS), cookie(config, config.nonceCookie, '', 0)])
  } catch (error) {
    return response(error instanceof AuthError ? error.status : 503, { error: error instanceof AuthError ? error.code : 'auth_unavailable' })
  }
}
