export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='GET'&&req.method!=='HEAD') {
    res.setHeader('Allow','GET, HEAD');res.statusCode=405;return res.end(JSON.stringify({error:'GET 또는 HEAD 요청만 지원합니다.'}))
  }
  // Full OHLCV histories exceed a serverless function's response-size limit.
  // Let the existing fetch caller follow a temporary redirect to the same public
  // snapshot CDN that previously supplied this proxy. The browser still validates
  // the JSON and falls back to its bundled snapshot on any loading failure.
  // The destination is fixed; request URLs, cookies and headers are not forwarded.
  res.setHeader('Location','https://khcho9642-sketch.github.io/ai-chain-prototype/data/market.json?t='+Math.floor(Date.now()/60000))
  res.statusCode=307
  return res.end()
}
