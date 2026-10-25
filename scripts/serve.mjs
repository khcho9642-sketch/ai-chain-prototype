import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
const root=process.cwd()
createServer(async(req,res)=>{
  try {
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const path=resolve(root,'.'+(name==='/'?'/index.html':name))
    if(!path.startsWith(root+sep)){res.writeHead(403);return res.end()}
    const content=await readFile(path)
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'})[extname(path)]||'application/octet-stream')
    res.end(content)
  }catch{res.writeHead(404);res.end('Not found')}
}).listen(5175,'127.0.0.1',()=>console.log('http://127.0.0.1:5175'))
