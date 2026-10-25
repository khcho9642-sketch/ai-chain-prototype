import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize, instruments } from './collect-market.mjs'
const result = {meta:{regularMarketPrice:110,regularMarketTime:1704326400,exchangeTimezoneName:'UTC',chartPreviousClose:50},timestamp:[1704153600,1704240000,1704326400],indicators:{quote:[{close:[99,100,110],volume:[1,2,3]}]}}
test('previous close comes from previous trading date, never start of year', () => { const q = normalize(result); assert.equal(q.previousClose,100); assert.equal(q.change,10); assert.equal(q.changePercent,10) })
test('missing values and gaps are kept unavailable rather than invented', () => { const q=normalize({...result,indicators:{quote:[{close:[null,100,110]}]}}); assert.equal(q.bars.length,2); assert.equal(q.volume,null); assert.equal(q.bars[0].open,null) })
test('provider previous close takes priority', () => { const q=normalize({...result,meta:{...result.meta,previousClose:105}}); assert.equal(q.previousClose,105); assert.equal(q.change,5) })
test('catalog covers all eight links and contains unique symbols', () => { assert.equal(new Set(instruments.map(q=>q.symbol)).size,instruments.length); for(let chain=1;chain<=8;chain++) assert.ok(instruments.some(q=>q.chains.includes(chain))) })
test('data center REITs belong to infrastructure', () => { for(const symbol of ['EQIX','DLR']) assert.deepEqual(instruments.find(q=>q.symbol===symbol).chains,[6]) })
