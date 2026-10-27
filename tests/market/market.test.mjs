import test from 'node:test'
import assert from 'node:assert/strict'
import { instruments } from '../../assets/instruments.js'
import { normalizeSymbol, readSymbols, filterQuotes, snapshotBars } from '../../assets/market-core.js'
test('catalog covers expanded source-backed companies and preserves the merged market tools',()=>{
  assert.ok(instruments.length>=90)
  assert.equal(new Set(instruments.map(q=>q.symbol)).size,instruments.length)
  for(let i=1;i<=8;i++)assert.ok(instruments.some(q=>q.chains.includes(i)))
  for(const symbol of ['EQIX','DLR'])assert.deepEqual(instruments.find(q=>q.symbol===symbol).chains,[6])
  for(const symbol of ['AAPL','TSLA','035720.KS','GC=F','CL=F','BTC-USD'])assert.ok(instruments.some(q=>q.symbol===symbol))
})
test('watch storage accepts legacy Korean codes and rejects invalid shapes',()=>{
  assert.deepEqual(readSymbols('["005930","AAPL","AAPL","https://evil",{},null]'),['005930.KS','AAPL'])
  assert.deepEqual(readSymbols('{"AAPL":true}'),[])
  assert.deepEqual(readSymbols('broken'),[])
  assert.equal(normalizeSymbol(' 247540.kq '),'247540.KQ')
})
test('interest, market and chain filters compose with search',()=>{
  assert.equal(filterQuotes(instruments,{group:'관심',watch:['EQIX','DLR'],chain:6,search:'리츠'}).length,2)
  assert.equal(filterQuotes(instruments,{group:'국내',search:'005930'}).length,1)
  assert.equal(filterQuotes(instruments,{group:'시장',search:'WTI'}).length,1)
})
test('snapshots retain true intraday and long term series',()=>{
  const q={bars:[{time:1,close:10},{time:4000000,close:20}],histories:{'1d':[{time:5,close:15}],'5y':[{time:9,close:30}]}}
  assert.deepEqual(snapshotBars(q,'1d'),q.histories['1d'])
  assert.deepEqual(snapshotBars(q,'5y'),q.histories['5y'])
  assert.equal(snapshotBars(q,'1mo').length,1)
  assert.deepEqual(snapshotBars(undefined,'5d'),[])
})

test('chart fallback uses the requested range and never a previous range response',async()=>{
  const {chooseBars}=await import('../../assets/market-core.js')
  const snapshot={bars:[{time:100,close:1},{time:200,close:2}],histories:{'1d':[{time:300,close:3}]}}
  const oldResponse={range:'1d',bars:[{time:400,close:4}]}
  assert.deepEqual(chooseBars(snapshot,'1y',oldResponse),snapshot.bars)
  assert.deepEqual(chooseBars(snapshot,'1d',oldResponse),oldResponse.bars)
  assert.deepEqual(chooseBars(undefined,'1y',oldResponse),[])
})
test('newer snapshots supersede older API metadata',async()=>{
  const {newestQuote}=await import('../../assets/market-core.js')
  const snapshot={price:12,fetchedAt:'2026-10-26T01:00:00Z'},old={price:10,fetchedAt:'2026-10-26T00:00:00Z'}
  assert.equal(newestQuote(snapshot,old).price,12)
  assert.equal(newestQuote(old,snapshot).price,12)
})
