const routes = Object.freeze({ config: '/api/auth/config', nonce: '/api/auth/nonce', google: '/api/auth/google', me: '/api/auth/me', logout: '/api/auth/logout', profile: '/api/auth/profile' })

export class MemberAuthError extends Error {
  constructor(code, status = 0) { super(code); this.name = 'MemberAuthError'; this.code = code; this.status = status }
}

export function memberAuthMessage(error) {
  if (error?.code === 'invalid_nickname') return '닉네임은 공백 없이 2~20자의 문자·숫자·밑줄로 입력해 주세요.'
  if (error?.status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
  if (error?.status === 401 || ['invalid_token', 'invalid_nonce', 'nonce_expired', 'nonce_required'].includes(error?.code)) return '로그인 확인 시간이 만료되었거나 확인에 실패했습니다. 다시 시도해 주세요.'
  if (['not_configured', 'auth_not_configured', 'unavailable'].includes(error?.code) || [404, 503].includes(error?.status)) return 'Google 로그인 연결을 준비 중입니다. 잠시 후 다시 이용해 주세요.'
  if (error?.code === 'google_script_failed') return 'Google 로그인 화면을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'
  if (error?.code === 'timeout') return '응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
  return '로그인을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

// A server response is the only source of signed-in state. ID tokens are never
// decoded into a local user, or saved in browser storage.
export function normalizeMemberNickname(value) {
  if (typeof value !== 'string') throw new MemberAuthError('invalid_nickname', 400)
  const nickname = value.normalize('NFC')
  const length = [...nickname].length
  if (length < 2 || length > 20 || !/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*$/u.test(nickname)) throw new MemberAuthError('invalid_nickname', 400)
  return nickname
}

export function readMember(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 255 ||
      typeof value.needsNickname !== 'boolean' || !(value.nickname === null || typeof value.nickname === 'string') ||
      value.needsNickname !== (value.nickname === null)) throw new MemberAuthError('invalid_response')
  let nickname = null
  if (value.nickname !== null) {
    try { nickname = normalizeMemberNickname(value.nickname) } catch { throw new MemberAuthError('invalid_response') }
  }
  // Google profile fields are deliberately excluded from the display identity.
  return { id: value.id, nickname, needsNickname: value.needsNickname }
}

export function createMemberAuthClient({ fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  async function request(route, body) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(routes[route], {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      let data
      try { data = await response.json() } catch { throw new MemberAuthError('invalid_response', response.status) }
      if (!response.ok) throw new MemberAuthError(typeof data?.error === 'string' ? data.error : 'request_failed', response.status)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new MemberAuthError('invalid_response', response.status)
      return data
    } catch (error) {
      if (error instanceof MemberAuthError) throw error
      throw new MemberAuthError(controller.signal.aborted ? 'timeout' : 'network_error')
    } finally { clearTimeout(timeout) }
  }
  return {
    async config() {
      const value = await request('config')
      if (value.enabled === false) return { enabled: false, clientId: '' }
      if (value.enabled !== true || typeof value.clientId !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.clientId)) throw new MemberAuthError('invalid_response')
      return { enabled: true, clientId: value.clientId }
    },
    async nonce() {
      const value = await request('nonce')
      if (typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(value.nonce)) throw new MemberAuthError('invalid_response')
      return value.nonce
    },
    async me() { const value = await request('me'); return value.user === null ? null : readMember(value.user) },
    async google(credential) {
      if (typeof credential !== 'string' || credential.length < 20 || credential.length > 16384) throw new MemberAuthError('invalid_token', 401)
      return readMember((await request('google', { credential })).user)
    },
    async profile(nickname) {
      return readMember((await request('profile', { nickname: normalizeMemberNickname(nickname) })).user)
    },
    async logout() {
      const value = await request('logout', {})
      if (value.loggedOut !== true) throw new MemberAuthError('invalid_response')
    },
  }
}
