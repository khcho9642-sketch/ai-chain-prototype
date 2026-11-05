import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { AGENTS } from '../../server/community/policy.mjs'
import { personaRewritePrompt, personaPeerPrompt, personaComebackPrompt } from '../../server/community/persona-prompts.mjs'

const today = JSON.parse(await readFile(new URL('../../data/today-picks.json', import.meta.url), 'utf8'))
const reports = today.reports
const rewrites = reports.map(report => ({ parentId: report.id, agent: report.agent, headline: report.agent + '의 분석 제목', comment: report.agent + '의 실제 메인 댓글 입력', analysis: report.agent + '의 실제 분석 입력' }))

test('self-rewriting supplies each authors voice, informal speech policy and unchanged numerical source context', () => {
  const before = JSON.stringify(reports)
  for (const report of reports) {
    const prompt = personaRewritePrompt({ agent: report.agent, report })
    assert.ok(prompt.includes(AGENTS[report.agent].style))
    assert.match(prompt, /반말\/해체/u)
    const supplied = JSON.parse(prompt.split('\n\n인용 자료:\n')[1])
    assert.equal(supplied.parentId, report.id)
    assert.equal(supplied.report, report.report)
    assert.deepEqual(supplied.fairValue, report.fairValue)
  }
  assert.equal(JSON.stringify(reports), before)
  assert.throws(() => personaRewritePrompt({ agent: 'claude', report: reports.find(report => report.agent === 'gpt') }), /invalid_persona_parent/u)
})

test('peer dialogue receives the actual three rewrites, addresses the other authors and excludes its own source as a reply target', () => {
  for (const agent of Object.keys(AGENTS)) {
    const prompt = personaPeerPrompt({ agent, reports, rewrites })
    assert.ok(prompt.includes(AGENTS[agent].style))
    assert.match(prompt, /이름으로 한 번 이상 불러/u)
    assert.match(prompt, /반말\/해체/u)
    const [rewritten, originals] = prompt.split('\n\n이번 실제 재작성 분석 3개:\n')[1].split('\n\n사실·수치 대조용 기존 두 원문:\n')
    assert.deepEqual(JSON.parse(rewritten), rewrites)
    assert.deepEqual(JSON.parse(originals).map(row => row.parentId), reports.filter(report => report.agent !== agent).map(report => report.id))
  }
})

test('the return reply is grounded in the authors rewrite and exact peer text and reply IDs', () => {
  for (const report of reports) {
    const rewrite = rewrites.find(row => row.agent === report.agent)
    const peerResponses = Object.keys(AGENTS).filter(agent => agent !== report.agent).map(agent => ({ id: 'reply-' + agent, agent, text: agent + '가 실제로 한 반박 입력' }))
    const prompt = personaComebackPrompt({ agent: report.agent, report, rewrite, peerResponses })
    assert.ok(prompt.includes(AGENTS[report.agent].style))
    assert.match(prompt, /이름을 불러/u)
    assert.match(prompt, /replyToIds/u)
    assert.match(prompt, /반말\/해체/u)
    const [own, rest] = prompt.split('\n\n네 실제 재작성:\n')[1].split('\n\n다른 두 AI의 실제 댓글:\n')
    assert.deepEqual(JSON.parse(own), rewrite)
    assert.deepEqual(JSON.parse(rest.split('\n\n기존 원문:\n')[0]), peerResponses)
    assert.throws(() => personaComebackPrompt({ agent: report.agent, report, rewrite, peerResponses: peerResponses.slice(0, 1) }), /invalid_comeback_context/u)
  }
})
