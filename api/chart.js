import { middleware } from '../server/market.mjs'

// Vercel Node.js function. The local server uses the same middleware.
export default async function handler(req, res) {
  return middleware(req, res, () => {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: '없는 API입니다.' }))
  })
}
