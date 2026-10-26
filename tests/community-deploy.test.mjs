import test from 'node:test'
import assert from 'node:assert/strict'
import {checkPublicCommunity} from '../scripts/community-check-public.mjs'

const expected={enabled:true,developmentOnly:false,auth:'member',registration:'invite',mode:'review_only',autoPublishAllowed:false}
const addresses={apiOrigin:'https://community.example.com',siteOrigin:'https://ai-chain-prototype.vercel.app'}
const respond=(body=expected,headers={})=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json','access-control-allow-origin':addresses.siteOrigin,...headers}})

test('public deployment probe is read-only, checks the exact site origin and keeps real AI verification separate',async()=>{
  let calls=0
  const result=await checkPublicCommunity({...addresses,fetcher:async(url,options)=>{
    calls++;assert.equal(url.href,'https://community.example.com/api/community/status');assert.equal(options.headers.Origin,addresses.siteOrigin);assert.equal(options.redirect,'error');assert.ok(!options.headers.Authorization);assert.equal(options.method,undefined);return respond()
  }})
  assert.equal(calls,1);assert.equal(result.reachable,true);assert.equal(result.actualModelCallsVerified,false)
})
test('public deployment probe rejects HTTP, credentials, paths and malformed origins before network access',async()=>{
  for(const value of ['http://community.example.com','https://user:pass@community.example.com','https://community.example.com/api/community','https://community.example.com/?secret=x','broken']){
    await assert.rejects(checkPublicCommunity({...addresses,apiOrigin:value,fetcher:()=>assert.fail('unexpected network request')}))
  }
})
test('a healthy page or development server cannot pass as the production member API',async()=>{
  for(const body of [{...expected,developmentOnly:true},{...expected,auth:'local-operator'},{...expected,registration:'open'},{...expected,mode:'auto'},{...expected,autoPublishAllowed:true},{}]){
    await assert.rejects(checkPublicCommunity({...addresses,fetcher:async()=>respond(body)}))
  }
  await assert.rejects(checkPublicCommunity({...addresses,fetcher:async()=>respond(expected,{'access-control-allow-origin':'*'})}))
  await assert.rejects(checkPublicCommunity({...addresses,fetcher:async()=>new Response('<html>Login</html>',{headers:{'content-type':'text/html'}})}))
  await assert.rejects(checkPublicCommunity({...addresses,fetcher:async()=>new Response('Unavailable',{status:503})}))
})
