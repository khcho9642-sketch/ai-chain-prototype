import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultList, listHref, readList, matchCompanies, parseCompanyRoute } from '../../assets/company-browse.js'
import { catalog } from '../../assets/company-catalog.js'
import { asOf, yearsById } from '../../assets/company-financial-snapshot.js'

test('directory and listed companies keep their own stable, shareable routes', () => {
  assert.equal(parseCompanyRoute('#data'), null)
  assert.equal(parseCompanyRoute('#company-info-extra'), null)
  assert.deepEqual(parseCompanyRoute('#company-info?tab=all'), {kind:'list'})
  assert.deepEqual(parseCompanyRoute('#company-info/company/C0582/quote?listing=042700.KS'), {kind:'detail',id:'C0582',tab:'quote'})
  assert.equal(parseCompanyRoute('#company-info/company/%E0%A4').kind,'missing')
  const company = catalog.companies[0]
  const state = {...defaultList,tab:'all',q:'삼성 & AI+칩',country:company.country,sector:company.sectorId,listing:'listed',limit:50}
  assert.deepEqual(readList(listHref(state),catalog), state)
})

test('switching from core to all retains combined product, listing, country and sector filters', () => {
  const company = {id:'x',name:'한미반도체',englishName:'Hanmi Semiconductor',aliases:['한미'],product:'TC 본더',
    country:'한국',sectorId:'equipment',secondarySectorIds:['packaging'],listings:[{ticker:'042700.KS'}],listed:true,selection:null}
  const filters = {...defaultList,q:'tc본 더',country:'한국',sector:'equipment',listing:'listed'}
  assert.equal(matchCompanies([company],filters).length,0)
  assert.deepEqual(matchCompanies([company],{...filters,tab:'all'}),[company])
  assert.equal(matchCompanies([company],{...filters,tab:'all',country:'미국'}).length,0)
  assert.equal(matchCompanies([company],{...filters,tab:'all',sector:'packaging'}).length,0)
  assert.equal(matchCompanies([company],{...filters,tab:'all',listing:'private'}).length,0)
  assert.equal(matchCompanies([company],{...filters,tab:'all',q:'042700.ks'}).length,1)
})

test('financial links resolve to the right issuer, preserve missing years and expose only cited annual values', () => {
  assert.match(asOf,/^\d{4}-\d{2}-\d{2}$/)
  const ids = catalog.companies.map(c => c.financialId).filter(Boolean)
  assert.equal(new Set(ids).size,ids.length)
  for (const id of ids) {
    const years = yearsById[id]
    assert.ok(Array.isArray(years) && years.length <= 5, id)
    assert.deepEqual(years.map(y => y.fiscalYear), [...new Set(years.map(y => y.fiscalYear))].sort((a,b) => b-a))
    for (const year of years) {
      assert.match(year.currency,/^[A-Z]{3}$/)
      assert.ok(['consolidated','separate','unknown'].includes(year.scope))
      for (const [key,fact] of Object.entries(year.facts)) {
        assert.ok(['revenue','operating_income','operating_cash_flow'].includes(key))
        if (fact.pending) { assert.equal(fact.value,undefined); continue }
        assert.ok(Number.isFinite(fact.value))
        assert.equal(new URL(fact.url).protocol,'https:')
        assert.ok(fact.provider)
      }
    }
  }
})
