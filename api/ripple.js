export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='GET'&&req.method!=='HEAD') {
    res.setHeader('Allow','GET, HEAD');res.statusCode=405;return res.end(JSON.stringify({error:'GET 또는 HEAD 요청만 지원합니다.'}))
  }
  // Read only the public, precomputed feed. Never pass request URLs or private
  // headers to the source, and never run market collection from a page request.
  res.setHeader('Location','https://khcho9642-sketch.github.io/ai-chain-prototype/data/ripple.json?t='+Math.floor(Date.now()/60000))
  res.statusCode=307
  return res.end()
}
