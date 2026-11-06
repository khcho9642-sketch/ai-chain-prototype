import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateIndustry } from '../../assets/industry-core.js'
import { collectKosis } from './collect-kosis.mjs'
import { collectOfficialTrade } from './official-trade.mjs'
import { collectTsmc } from './collect-tsmc.mjs'

export async function collectIndustry(output = 'data/industry.json') {
  const previous = validateIndustry(JSON.parse(await readFile(output, 'utf8')))
  const now = new Date()
  const attemptedAt = now.toISOString()
  const checkedToday = previous.attemptedAt?.slice(0, 10) === attemptedAt.slice(0, 10)
  const dailyRefresh = !checkedToday || process.argv.includes('--force')
  const oldGaps = previous.gaps || []
  const isKosisGap = gap => gap.id?.startsWith('kosis-')
  const hasKosisState = previous.sources.some(source => source.id === 'kosis-mining-manufacturing') || oldGaps.some(isKosisGap)
  const keyJustAdded = Boolean(process.env.KOSIS_API_KEY?.trim()) && oldGaps.some(gap => gap.id === 'kosis-key-missing')
  if (!dailyRefresh && hasKosisState && !keyJustAdded) {
    console.log('산업통계: 오늘 확인한 자료 유지 (하루 한 번 갱신)')
    return previous
  }

  const series = new Map(previous.series.map(item => [item.id, item]))
  const sources = new Map(previous.sources.map(source => [source.id, source]))
  let gaps = oldGaps.filter(gap => !isKosisGap(gap))
  if (dailyRefresh) {
    const trade = await collectOfficialTrade(previous, { now })
    for (const item of trade.series) {
      series.set(item.id, { ...item, checkedAt: item.fetchedAt || item.checkedAt, error: item.refreshError || item.error })
    }
    for (const source of trade.sources) sources.set(source.id, source)
    gaps = gaps.filter(gap => !gap.id?.startsWith('ecos-') && gap.id !== 'customs-hs-weight')
    gaps.push(...trade.gaps.map(gap => ({ ...gap, name: gap.name || '한국은행 통계 갱신', reason: gap.reason || gap.message })))
    const revenue = await collectTsmc(series.get('tsmc-revenue'), { now })
    series.set(revenue.id, revenue)
  }

  // Also try KOSIS on its first deployment or when a key arrives after the daily collection.
  const kosis = await collectKosis(previous, { now })
  for (const item of kosis.series) series.set(item.id, item)
  for (const source of kosis.sources) sources.set(source.id, source)
  gaps.push(...kosis.gaps)

  const data = validateIndustry({
    ...previous, generatedAt: attemptedAt, attemptedAt, sources: [...sources.values()], series: [...series.values()], gaps,
  })
  await mkdir(dirname(resolve(output)), { recursive: true })
  await writeFile(output + '.tmp', JSON.stringify(data) + '\n')
  await rename(output + '.tmp', output)
  console.log(`산업통계 ${data.series.length}개 · ${data.series.reduce((n, item) => n + item.points.length, 0)}개 월별 관측치 · 갱신 실패 ${data.series.filter(item => item.error).length}개`)
  if (kosis.gaps.some(gap => gap.id === 'kosis-key-missing')) console.log('KOSIS: 인증키 등록 대기')
  if (kosis.gaps.some(gap => gap.id === 'kosis-refresh-failed')) console.log('KOSIS: 통계 갱신 실패')
  return data
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  collectIndustry().catch(error => { console.error(error.message); process.exitCode = 1 })
}
