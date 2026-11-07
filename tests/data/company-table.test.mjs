import assert from 'node:assert/strict'
import test from 'node:test'
import { columns, columnsFor, sortCompanies, renderCell, tableHtml } from '../../assets/company-table.js'
import { defaultList,readList,listHref } from '../../assets/company-browse.js'
const companies=['A','B','C','D'].map((id,i)=>({id,name:id,product:'칩',sectorId:'s',country:'한국',listings:[],aliases:[],listed:i<3,selection:i===1?{order:1}:null}))
const sectors=new Map([['s',{name:'장비',color:'#aaa'}]])
const rows={A:{marketCapUsd:10,change1d:0},B:{marketCapUsd:50,change1d:-2},D:{valuationUsd:1000,valuationSourceUrl:'https://example.org/',valuationDate:'2026-05-10'}}
const marketFor=id=>rows[id]??null
test('all 14 default columns and preferences round-trip through a shared directory link',()=>{
  const state={...defaultList,tab:'all'}
  assert.equal(columnsFor(state.hidden).length,14)
  const prefs={...state,sort:'change1d',dir:'asc',hidden:'country,ticker'}
  assert.deepEqual(readList(listHref(prefs),{companies,sectors:[...sectors.values()]}),prefs)
  assert.equal(columnsFor('name,role,bad').length,13)
  const html=tableHtml(companies,state,sectors,marketFor)
  assert.equal((html.match(/scope="col"/g)||[]).length,14)
  assert.match(html,/aria-sort="descending"/)
  assert.match(html,/href="#company-info\/company\/B"/)
  assert.doesNotMatch(html,/href="#company-info\/company\/(A|C|D)"/)
})
test('market cap sorting excludes private valuations in both directions; zero remains a valid return',()=>{
  const order=(sort,dir)=>sortCompanies(companies,{sort,dir},sectors,marketFor).map(c=>c.id).join('')
  assert.equal(order('marketCapUsd','desc'),'BACD')
  assert.equal(order('marketCapUsd','asc'),'ABCD')
  assert.equal(order('change1d','asc'),'BACD')
})
test('separates valuation dates and missing data, sign of earnings and actual quote currency',()=>{
  const render=(id,c,row)=>renderCell(columns.find(x=>x.id===id),c,row,sectors)
  assert.match(render('marketCapUsd',companies[3],rows.D),/비상장·평가액.*2026-05-10/)
  assert.match(render('price',companies[0],{price:0,currency:'KRW'}),/>0<.*KRW/)
  assert.match(render('pe',companies[0],{loss:true}),/적자/)
  assert.match(render('pe',companies[0],{}),/자료 없음/)
})
