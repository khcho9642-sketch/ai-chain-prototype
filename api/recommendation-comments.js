import { readFileSync } from 'node:fs'
import { validateTodaySnapshot } from '../assets/today-core.js'
import { createRecommendationCommentsHandler } from '../server/recommendation-comments.mjs'
import { createBlobRecommendationCommentStore } from '../server/recommendation-comment-blob.mjs'

// This file is bundled with the function. Clients cannot create a report anchor.
function reportsSource() {
  const snapshot = JSON.parse(readFileSync(new URL('../data/today-picks.json', import.meta.url), 'utf8'))
  validateTodaySnapshot(snapshot)
  return snapshot
}

export default createRecommendationCommentsHandler({
  store: createBlobRecommendationCommentStore(),
  reportsSource,
})
