import { validateAiStatistics } from '../assets/ai-statistics-core.js'
import { validateTokenSnapshot } from '../assets/token-core.js'
import { validateDisclosureSnapshot } from '../assets/ai-disclosure-core.js'
import { validateCompanyDisclosures } from '../assets/company-disclosures-core.js'

const validators = {'ai-statistics':validateAiStatistics, 'ai-tokens':validateTokenSnapshot, 'ai-disclosures':validateDisclosureSnapshot, 'company-disclosures':validateCompanyDisclosures}
export function aiSnapshotHandler(name, {fetcher = fetch} = {}) {
  if (!Object.hasOwn(validators, name)) throw new Error('지원하지 않는 공개 자료입니다.')
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (!['GET','HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD'); res.statusCode = 405
      return res.end(JSON.stringify({error:'GET 또는 HEAD 요청만 지원합니다.'}))
    }
    try {
      const response = await fetcher('https://khcho9642-sketch.github.io/ai-chain-prototype/data/' + name + '.json?t=' + Math.floor(Date.now() / 60000),
        {signal:AbortSignal.timeout(15000), redirect:'error'})
      if (!response.ok) throw new Error('스냅샷 조회 실패')
      const data = validators[name](await response.json())
      res.setHeader('Cache-Control','public, max-age=0, s-maxage=300'); res.statusCode = 200
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data))
    } catch {
      res.statusCode = 502; res.setHeader('Cache-Control','no-store')
      return res.end(JSON.stringify({error:'최신 공개 자료를 확인하지 못했습니다.'}))
    }
  }
}
