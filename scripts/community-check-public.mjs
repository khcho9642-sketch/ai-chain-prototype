import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

function origin(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('API와 웹사이트의 HTTPS 주소가 필요합니다.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('주소에는 HTTPS origin만 넣으세요. 경로·쿼리·자격증명은 넣지 않습니다.')
  }
  return url.origin
}

// Read-only probe: no login, secret, account creation, comment or worker request.
export async function checkPublicCommunity({ apiOrigin, siteOrigin, fetcher = fetch } = {}) {
  const api = origin(apiOrigin), site = origin(siteOrigin)
  const response = await fetcher(new URL('/api/community/status', api), {
    headers: { Accept: 'application/json', Origin: site },
    signal: AbortSignal.timeout(12000), redirect: 'error',
  })
  if (!response.ok) throw new Error(`공유 API 응답 HTTP ${response.status}`)
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('공유 API의 JSON 응답이 아닙니다.')
  if (response.headers.get('access-control-allow-origin') !== site) throw new Error('현재 웹사이트의 CORS 연결이 허용되지 않았습니다.')
  const body = await response.json()
  if (body.enabled !== true || body.developmentOnly !== false || body.auth !== 'member') throw new Error('운영용 회원 인증 API가 아닙니다.')
  if (body.registration !== 'invite' || body.mode !== 'review_only' || body.autoPublishAllowed !== false) {
    throw new Error('초기 운영 기준인 초대 가입·관리자 승인 모드를 확인하세요.')
  }
  return { apiOrigin: api, siteOrigin: site, reachable: true, authentication: 'member', registration: 'invite', mode: 'review_only', actualModelCallsVerified: false }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2) throw new Error('사용법: node scripts/community-check-public.mjs https://댓글-API-도메인 https://웹사이트-도메인')
  const result = await checkPublicCommunity({ apiOrigin: argv[0], siteOrigin: argv[1] })
  console.log(JSON.stringify(result, null, 2))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
