import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, findCompanyByTicker } from '../../assets/company-catalog.js';
import { companyHrefForTicker, companyHrefForQuery } from '../../assets/company-links.js';
import { discussionHref } from '../../assets/company-market.js';

test('every mapped security opens its issuer, including multiple listings', () => {
  for (const issuer of catalog.companies) {
    for (const { ticker } of issuer.listings) {
      assert.equal(findCompanyByTicker(ticker).id, issuer.id);
      assert.equal(companyHrefForTicker(ticker), '#company-info/company/' + encodeURIComponent(issuer.id));
      const [route, params] = companyHrefForTicker(ticker, 'quote').split('?');
      assert.equal(route, companyHrefForTicker(ticker) + '/quote');
      if (issuer.listings.length > 1) assert.equal(new URLSearchParams(params).get('listing'), ticker);
    }
  }
});

test('market indicators and unconnected discussions do not produce corporate links', () => {
  for (const symbol of ['GC=F', 'CL=F', '^KS11', 'BTC-USD']) {
    assert.equal(companyHrefForTicker(symbol), null);
    assert.equal(discussionHref({ discussionTicker: symbol }), null);
  }
  assert.equal(discussionHref({ discussionTicker: null }), null);
  assert.equal(discussionHref({ discussionTicker: '042700.KS' }), '#talk/042700.KS');
});

test('header search opens an exact company, security or unique Korean stock code', () => {
  assert.equal(companyHrefForQuery('Hanmi Semiconductor'), companyHrefForTicker('042700.KS'));
  assert.equal(companyHrefForQuery('한 미반도체'), companyHrefForTicker('042700.KS'));
  assert.equal(companyHrefForQuery('042700'), companyHrefForTicker('042700.KS', 'quote'));
  assert.equal(companyHrefForQuery(' asml.as '), companyHrefForTicker('ASML.AS', 'quote'));
  assert.equal(companyHrefForQuery('BTC-USD'), null);
});
