import { readFileSync } from 'node:fs'
import { validateDebateDay, validateDebateIndex } from '../assets/debate-core.js'
import { createDebateVotesHandler } from '../server/debate-votes.mjs'
import { createBlobDebateVoteStore } from '../server/debate-vote-store.mjs'

// Resolve only manifest-published, validated files bundled with this deployment.
// Client input never becomes a filesystem path or an invented voting topic.
function debatesSource(debateId) {
  const index = validateDebateIndex(JSON.parse(readFileSync(new URL('../data/debate/index.json', import.meta.url), 'utf8')))
  const entry = index.days.find(row => row.id === debateId)
  if (!entry) return { debates: [] }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(entry.date)) throw new Error('Invalid debate publication')
  const day = validateDebateDay(JSON.parse(readFileSync(new URL('../data/debate/' + entry.date + '.json', import.meta.url), 'utf8')))
  if (day.id !== entry.id || day.date !== entry.date || day.topic.ticker !== entry.topic.ticker) throw new Error('Mismatched debate publication')
  return { debates: [day] }
}

export default createDebateVotesHandler({ store: createBlobDebateVoteStore(), debatesSource })
