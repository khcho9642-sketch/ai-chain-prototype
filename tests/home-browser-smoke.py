"""Isolated homepage acceptance checks using in-memory fictional market fixtures.
Never publishes data, invokes AI, or contacts a real market-data provider.
Run: python3 tests/home-browser-smoke.py --browser /path/to/chromium
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--browser', default=None)
parser.add_argument('--output', default='.local/home-browser-smoke')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = (root / args.output).resolve()
output.mkdir(parents=True, exist_ok=True)

# Generate deterministic, past-session data in memory. These numbers test the UI
# contract only. Actual source files and deployed snapshots remain untouched.
fixture_script = r"""
import {focusCompanies} from './assets/home-focus.js';
import {SECTORS,COMPANIES} from './assets/home-map-core.js';
import {buildActualMap} from './assets/home-map-data.js';
import {MAP_COMPANIES} from './assets/home-map-universe.js';
import {buildRippleSnapshot} from './assets/ripple-core.js';
import {buildSectorReturns} from './assets/home-performance.js';
const DAY=86400000, now=Date.now(), stamp=new Date(now).toISOString();
const iso=ms=>new Date(ms).toISOString().slice(0,10);
const weekday=date=>![0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());
function shiftBusiness(date,count){let ms=Date.parse(date+'T12:00:00Z'),left=Math.abs(count);while(left){ms+=Math.sign(count)*DAY;if(weekday(iso(ms)))left--;}return iso(ms);}
let today=iso(now);while(!weekday(today))today=iso(Date.parse(today+'T12:00:00Z')-DAY);
const usEnd=shiftBusiness(today,-3),krEnd=shiftBusiness(usEnd,1);
function datesTo(end){const rows=[];let date=end;while(rows.length<100){if(weekday(date))rows.unshift(date);date=iso(Date.parse(date+'T12:00:00Z')-DAY);}let annual=iso(Date.parse(end+'T12:00:00Z')-365*DAY);while(!weekday(annual))annual=shiftBusiness(annual,-1);rows.unshift(annual);return rows;}
const usDates=datesTo(usEnd),krDates=datesTo(krEnd);
const fxRates={USD:1,KRW:1400,JPY:150,TWD:32,EUR:.9,CHF:.85,HKD:7.8,SGD:1.3,CNY:7.1,GBP:.8,DKK:6.8,SEK:10,INR:85,MYR:4.4,THB:34,AUD:1.5,NZD:1.6,IDR:16000,CAD:1.4,BRL:5.7,ZAR:18,ILS:3.7,SAR:3.75,QAR:3.64,TRY:35,AED:3.67};
const targets=new Map();
for(const company of MAP_COMPANIES)for(const listing of company.listings)targets.set(listing.ticker,{...company,ticker:listing.ticker,currency:listing.currency});
for(const company of COMPANIES)if(!targets.has(company.ticker))targets.set(company.ticker,{...company,currency:/\.(KS|KQ)$/.test(company.ticker)?'KRW':/\.T$/.test(company.ticker)?'JPY':/\.(TW|TWO)$/.test(company.ticker)?'TWD':'USD'});
const quotes=[...targets.values()].map((company,index)=>{
 const focus=focusCompanies.find(row=>row.ticker===company.ticker);
 const within=focus?focusCompanies.filter(row=>row.sectorId===focus.sectorId).findIndex(row=>row.ticker===company.ticker):index%5;
 const currency=company.currency;
 const market=currency==='KRW'?'KR':currency==='USD'?'US':'OTHER';
 const timezone=({KRW:'Asia/Seoul',JPY:'Asia/Tokyo',TWD:'Asia/Taipei',EUR:'Europe/Paris',CHF:'Europe/Zurich',HKD:'Asia/Hong_Kong',SGD:'Asia/Singapore',CNY:'Asia/Shanghai',USD:'America/New_York',GBP:'Europe/London',DKK:'Europe/Copenhagen',SEK:'Europe/Stockholm',INR:'Asia/Kolkata',MYR:'Asia/Kuala_Lumpur',THB:'Asia/Bangkok',AUD:'Australia/Sydney',NZD:'Pacific/Auckland',IDR:'Asia/Jakarta',CAD:'America/Toronto',BRL:'America/Sao_Paulo',ZAR:'Africa/Johannesburg',ILS:'Asia/Jerusalem',SAR:'Asia/Riyadh',QAR:'Asia/Qatar',TRY:'Europe/Istanbul',AED:'Asia/Dubai'})[currency];
 const dates=market==='KR'?krDates:usDates;
 let price=100+index*3;
 const bars=dates.map((date,j)=>{
  let change=j%5===0?2.2+within*.2:.05+within*.16;
  if(company.ticker==='ASML')change=j%5===0?-3.2:-.1;
  if(j===dates.length-1){change=({NVDA:8,MU:7,DELL:6,ASML:5.5})[company.ticker]??(market==='KR'?2.1:1.2+within*.1);}
  price*=1+change/100;
  const time=Date.parse(date+(market==='US'||['CAD','BRL'].includes(currency)?'T14:30:00Z':'T00:00:00Z'))/1000;
  return {time,open:price/(1+change/100),high:price*1.01,low:price*.99,close:price,volume:1000000+j};
 });
 const latest=bars.at(-1),prior=bars.at(-2),capUSD=focus?(within===4?8e12:(within+1)*1e10):(within+1)*1e9;
 return {symbol:company.ticker,name:company.name,currency,timezone,exchange:market==='US'?'NASDAQ':market==='KR'?'KRX':'fixture-exchange',
  price:latest.close,previousClose:prior.close,change:latest.close-prior.close,changePercent:(latest.close/prior.close-1)*100,
  closeDate:dates.at(-1),previousCloseDate:dates.at(-2),priceBasis:'previous-completed-session',range:'1y',interval:'1d',marketTime:latest.time,
  fetchedAt:stamp,source:'Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/'+encodeURIComponent(company.ticker)+'/',status:'ok',error:null,
  delayed:true,bars,histories:{},marketCap:capUSD*fxRates[currency],marketCapStatus:'ok',marketCapCurrency:currency,marketCapObservedAt:stamp,marketCapFetchedAt:stamp,marketCapBasis:'provider-current',
  marketCapHistory:focus?dates.map(date=>({date,value:capUSD*fxRates[currency],currency,basis:'provider-dated',source:'browser-fixture'})):[],
  fixture:true};
});
const unionDates=[...new Set([...usDates,...krDates])].sort();
const market={schemaVersion:1,generatedAt:stamp,source:'Yahoo Finance',mode:'scheduled-close',priceBasis:'previous-completed-session',refreshMinutes:null,
 coverage:{companyCount:586,listedCompanyCount:537,unlistedCompanyCount:49,targetSymbols:quotes.length},
 fxHistory:Object.fromEntries(Object.keys(fxRates).filter(currency=>currency!=='USD').map(currency=>[currency,{currency,baseCurrency:'USD',quoteConvention:'currency-per-USD',source:'browser-fixture',timezone:'UTC',fetchedAt:stamp,observations:unionDates.map(date=>({date,unitsPerUSD:fxRates[currency]}))}])),
 quotes,fixtureOnly:true};
const ripple=buildRippleSnapshot({marketSnapshot:market,now});
const model=buildSectorReturns({snapshot:market,period:'3mo',now});
if(ripple.triggers.length!==3||model.sectors.some(s=>s.eq===null||s.cap===null)||!model.sectors.some(s=>s.divergence))throw new Error('Browser fixture must exercise both weighted returns and three movements');
const calm=structuredClone(market);
calm.generatedAt=new Date(now+1000).toISOString();
for(const quote of calm.quotes){quote.bars.at(-1).close=quote.bars.at(-2).close*1.001;quote.price=quote.bars.at(-1).close;quote.changePercent=.1;}
const calmRipple=buildRippleSnapshot({marketSnapshot:calm,now:now+1000});
const actualMap=buildActualMap({snapshot:market,now});
if(actualMap.coverage.catalogCount!==58||actualMap.coverage.unlistedCompanyCount!==4||actualMap.coverage.renderableCount!==54||actualMap.coverage.returnableCount!==54)throw new Error('Browser map fixture must cover exactly approved58 companies with54 listed and4 private');
const incomplete=structuredClone(market);
incomplete.quotes.find(q=>q.symbol==='AMD').marketCap=null;
delete incomplete.fxHistory.EUR;
const nvda=incomplete.quotes.find(q=>q.symbol==='NVDA');nvda.bars=nvda.bars.slice(-1);
const incompleteMap=buildActualMap({snapshot:incomplete,now});
console.log(JSON.stringify({market,ripple,model,actualMap,incomplete,incompleteMap,calm,calmRipple,sectors:SECTORS,usEnd,krEnd}));
"""
prepared = subprocess.run(['node', '--input-type=module'], cwd=root, input=fixture_script,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
fixture_data = json.loads(prepared.stdout)
feeds = {'market': fixture_data['market'], 'ripple': fixture_data['ripple'], 'market_status': 200, 'ripple_status': 200}
page_errors = []
pages = []
checks = []
price_requests = []

def percent(value):
    return ('+' if value > 0 else '') + f'{value:.2f}%'


def wait_home(page):
    page.locator('#v-home .sector-return-card').first.wait_for()
    page.wait_for_function("document.querySelector('#v-home')?.shadowRoot?.querySelectorAll('[data-ripple-trigger]').length === 3")
    page.wait_for_function("(() => {const cards=[...document.querySelector('#v-home').shadowRoot.querySelectorAll('.sector-return-value')];return cards.length===10 && cards.every(value=>value.textContent.trim()!=='—')})()")
    return page.locator('#v-home')


def verify_header_indices(page):
    strip = page.locator('header .wrap.top > .brand + [data-index-strip]')
    strip.wait_for(state='visible')
    assert strip.locator('[data-index-strip-status],.index-strip-heading').count() == 0
    assert '실시간 갱신 중지 · 저장된 종가' not in page.locator('body > header').inner_text()
    page.wait_for_function("document.querySelectorAll('header [data-index-strip] [data-index-symbol]').length === 5")
    assert strip.locator('[data-index-symbol]').evaluate_all(
        'cards => cards.map(card => card.dataset.indexSymbol)') == ['^IXIC', '^GSPC', '^KS11', '688825.SS', '^KQ11']
    geometry = strip.evaluate("""strip => {
      const brand = document.querySelector('header .wrap.top > .brand');
      const navigation = document.querySelector('header .topnav');
      const rect = element => { const box = element.getBoundingClientRect();
        return {left:box.left, right:box.right, top:box.top, bottom:box.bottom, height:box.height}; };
      return {headerChild:strip.parentElement.matches('header .wrap.top'), adjacentBrand:strip.previousElementSibling === brand,
        brand:brand.textContent.trim(), slot:strip.assignedSlot?.name || null, strip:rect(strip), logo:rect(brand),
        navigation:navigation && getComputedStyle(navigation).display !== 'none' ? rect(navigation) : null,
        homeStrip:!!document.querySelector('#v-home [data-index-strip]')};
    }""")
    assert geometry['headerChild'] and geometry['adjacentBrand'] and geometry['slot'] is None, geometry
    assert geometry['brand'].startswith('AI Value Chain') and not geometry['homeStrip'], geometry
    actual, logo = geometry['strip'], geometry['logo']
    assert logo['right'] - 1 <= actual['left'] <= logo['right'] + 32, geometry
    assert actual['top'] < logo['bottom'] and actual['bottom'] > logo['top'], geometry
    assert 0 < actual['height'] <= 71, geometry
    if geometry['navigation']:
        assert actual['bottom'] <= geometry['navigation']['top'] + 1, geometry
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    return strip


def attach_routes(context):
    encoded = {}
    def payload(name):
        # One encoding per feed object: full-universe fixtures are shared by all
        # page requests, including the normal60-second refresh.
        current=feeds[name]
        cached=encoded.get(name)
        if cached is None or cached[0] is not current:
            cached=(current,json.dumps(current,separators=(',',':')))
            encoded[name]=cached
        return cached[1]
    def market_response(route):
        price_requests.append(route.request.url)
        route.fulfill(status=feeds['market_status'], content_type='application/json', body=payload('market'))
    def ripple_response(route):
        price_requests.append(route.request.url)
        route.fulfill(status=feeds['ripple_status'], content_type='application/json', body=payload('ripple'))
    context.route('**/data/market-display.json', market_response)
    context.route('**/api/snapshot?*', market_response)
    context.route('**/data/market.json?*', market_response)
    context.route('**/data/ripple.json', ripple_response)
    context.route('**/api/ripple?*', ripple_response)
    context.route('**/data/ripple.json?*', ripple_response)
    context.route('**/api/chart?*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"homepage browser fixture: market calls disabled"}'))
    context.route('https://fonts.googleapis.com/**', lambda route: route.fulfill(status=200, content_type='text/css', body=''))


def new_page(context):
    page = context.new_page()
    pages.append(page)
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    return page


with tempfile.TemporaryDirectory(prefix='ai-home-browser-') as temp:
    key, cert = Path(temp)/'key.pem', Path(temp)/'cert.pem'
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env = dict(os.environ, COMMUNITY_BROWSER_FIXTURE='1', SMOKE_TLS_KEY=str(key), SMOKE_TLS_CERT=str(cert))
    backend = subprocess.Popen(['node','tests/helpers/browser-server.mjs'], cwd=root, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    try:
        endpoints = json.loads(backend.stdout.readline())
        origin = endpoints['siteOrigin']
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.browser or shutil.which('google-chrome') or shutil.which('chromium') or playwright.chromium.executable_path,
                                                  headless=True,args=['--no-sandbox'])
            context = browser.new_context(ignore_https_errors=True, viewport={'width':1440,'height':1100})
            attach_routes(context)
            page = new_page(context)
            page.clock.install()
            try:
                page.goto(origin+'/#home')
                home = wait_home(page)
                indices = verify_header_indices(page)
                saved_indices = indices.locator('[data-index-strip-cards]').text_content()
                indices.evaluate('element => { window.__persistentIndexStrip = element }')
                for menu in ['today','debate','sector-compare','data','company-info','map','compare','industry','scenario','talk','ai','home']:
                    page.evaluate('menu => { location.hash = menu }', menu)
                    page.wait_for_function('menu => document.body.dataset.page === menu', arg=menu)
                    verify_header_indices(page)
                    assert indices.evaluate('element => element === window.__persistentIndexStrip')
                    assert indices.locator('[data-index-strip-cards]').text_content() == saved_indices
                    if menu == 'compare':
                        buttons = page.locator('#v-compare [data-peer-jump]')
                        buttons.first.wait_for(state='attached')
                        assert buttons.all_text_contents()[:3] == ['소부장', '메모리', '파운드리·패키징']
                        assert buttons.evaluate_all('els => els.slice(0, 3).map(el => el.dataset.peerJump)') == ['1', '3', '2']
                    if menu == 'map':
                        nodes = page.locator('#mapRow .node')
                        assert nodes.locator('.name').all_text_contents()[:3] == ['소부장', '메모리', '파운드리·패키징']
                        assert nodes.locator('.num').all_text_contents()[:3] == ['01', '02', '03']
                        nodes.nth(2).click()
                        assert page.locator('#detail h2').inner_text() == '파운드리·패키징'
                        assert '선택한 고리 · 03' in page.locator('#detail').inner_text()
                        assert 'TSMC' in page.locator('#detail .chips').inner_text()
                    if menu == 'data':
                        assert page.locator('#market-filter option').all_text_contents()[1:4] == ['소부장', '메모리', '파운드리·패키징']
                        assert page.locator('#v-data [data-df]').all_text_contents()[1:4] == ['소부장', '메모리', '파운드리·패키징']
                home = wait_home(page)
                checks.append('five saved indices persist beside the top header logo across all twelve menus without a status sentence or changed values')
                cards = home.locator('.sector-return-card')
                assert cards.count() == 10
                assert cards.evaluate_all('els => els.slice(1, 3).map(el => el.dataset.sector)') == ['memory', 'foundry-packaging']
                assert cards.nth(1).locator('.sector-return-step').inner_text() == '02'
                assert cards.nth(2).locator('.sector-return-step').inner_text() == '03'
                assert home.locator('[data-home-weight=eq]').get_attribute('aria-pressed') == 'true'
                assert home.locator('[data-home-card-period]').input_value() == '3mo'
                assert '594개 기업' in home.locator('[data-home-coverage]').inner_text()
                assert '핵심 58개' in home.locator('[data-home-coverage]').inner_text()
                for sector in fixture_data['model']['sectors']:
                    card=home.locator('[data-sector="'+sector['sectorId']+'"]')
                    assert card.locator('.sector-return-value').count()==1
                    assert card.locator('.sector-return-value').inner_text()==percent(sector['eq'])
                    assert sector['name'] in card.locator('.sector-return-name').inner_text()
                    assert card.evaluate("el => el.style.getPropertyValue('--sector-color').toLowerCase()") == sector['color'].lower()
                    tag=card.locator('.sector-return-gap')
                    assert tag.is_visible() == (sector['divergence'] is not None)
                    if sector['divergence']: assert tag.inner_text()==sector['divergence']
                before=cards.locator('.sector-return-value').all_inner_texts()
                home.locator('[data-home-weight=cap]').click()
                weighted=cards.locator('.sector-return-value').all_inner_texts()
                assert before!=weighted
                for sector in fixture_data['model']['sectors']:
                    assert home.locator('[data-sector="'+sector['sectorId']+'"] .sector-return-value').inner_text()==percent(sector['cap'])
                assert page.evaluate("localStorage.getItem('ai-chain.home-weight.v1')")=='cap'
                page.reload(); home=wait_home(page)
                assert home.locator('[data-home-weight=cap]').get_attribute('aria-pressed')=='true'
                home.locator('[data-home-card-period]').select_option('1d')
                assert home.locator('[data-home-card-caption]').inner_text()=='선정 58개 중 상장 54개의 최근 1거래일 종가 수익률'
                assert home.locator('.sector-return-value').all_inner_texts()!=weighted
                checks.append('nine actual closed-price sector cards; equal/cap toggle, exact-date weights, divergence, storage and independent periods')

                chips=home.locator('[data-ripple-trigger]')
                assert chips.count()==3
                for index, expected in enumerate(fixture_data['ripple']['ripples']):
                    chips.nth(index).click()
                    assert chips.nth(index).get_attribute('aria-pressed')=='true'
                    center=home.locator('.ripple-trigger-card')
                    assert center.get_attribute('data-ripple-node')==expected['trigger']['ticker']
                    assert home.locator('[data-ripple-time]').inner_text()==expected['comparisonLabel']
                    expected_nodes=expected['upstream']+expected['downstream']
                    for value in expected_nodes:
                        assert value['syncRate'] is None or value['syncRate']>=50
                        current=home.locator('.ripple-company[data-ripple-node="'+value['ticker']+'"]')
                        assert current.count()==1
                        assert value['date'][5:].replace('-','.') in current.locator('.ripple-company-date').inner_text()
                    assert home.locator('.ripple-company[data-ripple-node=ASML]').count()==0
                chips.nth(0).click()
                assert '미국 '+fixture_data['usEnd'][5:].replace('-','.')+' 종가' in home.locator('[data-ripple-time]').inner_text()
                assert '한국 '+fixture_data['krEnd'][5:].replace('-','.')+' 종가' in home.locator('[data-ripple-time]').inner_text()
                home.locator('[data-ripple-lines] path').first.wait_for(state='attached')
                assert home.locator('[data-ripple-lines] path').count()>0
                text=home.inner_text()
                assert not any(word in text for word in ['추천','사라','팔라','목표가','영향을 줬다'])
                page.screenshot(path=str(output/'home-desktop.png'),full_page=True)
                checks.append('three selectable movements, Korean next-session dates, conditional sync filtering and desktop curves')

                search=home.get_by_role('searchbox',name='기업명 또는 티커 검색')
                search.fill('NVDA')
                assert home.locator('.tile').count()==1
                assert '+8.00%' in home.locator('.tile').inner_text()
                home.locator('.tile').click()
                assert '시총 관측' in home.locator('#selection').inner_text()
                assert '확정 종가' in home.locator('#selection').inner_text()
                assert fixture_data['usEnd'] in home.locator('#selection').inner_text()
                home.get_by_role('button',name='조회 조건 초기화',exact=True).click()
                assert home.locator('.tile').count()==fixture_data['actualMap']['coverage']['renderableCount']
                assert home.locator('.tile').count()==54
                news_section=home.locator('[data-map-private]')
                news_cards=news_section.locator('[data-map-private-company]')
                expected_news=[
                    ('OpenAI', '2026-11-06', 'https://openai.com/index/partnering-with-hacktron/'),
                    ('Anthropic', '2026-11-06', 'https://www.anthropic.com/research/components-of-agent-memory'),
                    ('DeepSeek', '2026-10-17', 'https://api-docs.deepseek.com/news/news261017/'),
                    ('Nscale', '2026-11-05', 'https://www.nscale.com/press-releases/nscale-microsoft-2025'),
                ]
                assert news_section.locator('h2').inner_text()=='핵심기업 최신 소식'
                assert news_cards.count()==len(expected_news)
                for index,(name,date,source) in enumerate(expected_news):
                    card=news_cards.nth(index)
                    assert card.locator('h3').inner_text()==name
                    assert card.locator('.map-private-news-title').inner_text().strip()
                    assert card.locator('.map-private-news-summary').inner_text().strip()
                    assert card.locator('time').get_attribute('datetime')==date
                    assert card.locator('a.map-private-news-source').get_attribute('href')==source
                    assert card.locator('.ticker,.return').count()==0
                assert home.locator('.tile[data-id="C0587"],.tile[data-ticker="NSCL"]').count()==0
                assert home.locator('.tile[data-ticker=AAPL],.tile[data-ticker=TSLA]').count()==0
                ids=home.locator('.tile').evaluate_all('els=>els.map(el=>el.dataset.id)')
                assert len(ids)==len(set(ids))
                expected_nvda=next(row for row in fixture_data['actualMap']['companies'] if row['ticker']=='NVDA')
                for period in ['1w','1m','1y','1d']:
                    home.locator('[data-period="'+period+'"]').click()
                    nvda=home.locator('.tile[data-ticker=NVDA]')
                    assert abs(float(nvda.get_attribute('data-return'))-expected_nvda['returns'][period])<1e-8
                    assert float(nvda.get_attribute('data-cap-usd'))==expected_nvda['capUSD']
                    assert home.locator('.tile').count()==fixture_data['actualMap']['coverage']['renderableCount']
                home.locator('#country').select_option('TW')
                assert 0<home.locator('.tile').count()<54
                home.get_by_role('button',name='조회 조건 초기화',exact=True).click()
                home.get_by_role('button',name='버블',exact=True).click()
                home.locator('.bubble-node').first.wait_for()
                axis_names = home.locator('.sector-axis-label').evaluate_all("els => els.slice(1, 3).map(el => el.getAttribute('aria-label'))")
                assert axis_names == ['메모리 분야 확대', '파운드리·패키징 분야 확대']
                assert home.locator('.bubble-node').count()==fixture_data['actualMap']['coverage']['returnableCount']
                assert home.locator('.bubble-node[data-id="C0587"],.bubble-node[data-ticker="NSCL"]').count()==0
                assert home.locator('[data-map-private-company]').count()==4
                home.get_by_role('button',name='히트맵',exact=True).click()
                home.locator('.sector-return-card[data-sector=memory]').click()
                assert home.locator('.sector-heading').count()==1
                home.locator('.sector-return-card[data-sector=memory]').click()
                assert home.locator('.sector-heading').count()==10
                home.locator('.ripple-trigger-card').click()
                page.wait_for_function("location.hash.startsWith('#company-info/company/')")
                checks.append('exact approved58 selection,54 listed heatmap/bubbles and four dated company news cards with official sources, no Apple/Tesla, exact NVDA completed return, provenance, search, sector and detail interactions')

                page.goto(origin+'/#home'); home=wait_home(page)
                incomplete=fixture_data['incomplete']
                feeds['market']=incomplete
                partial=fixture_data['incompleteMap']['coverage']
                page.evaluate("value => window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",incomplete)
                assert home.locator('.tile').count()==partial['renderableCount']
                assert partial['missingCap']>=1 and partial['missingFx']>0
                assert 'AMD' in home.locator('#map-exclusions').text_content()
                assert '시총 관측일 기준 환율 미확보' in home.locator('#map-exclusions').text_content()
                home.get_by_role('searchbox',name='기업명 또는 티커 검색').fill('NVDA')
                assert home.locator('.tile').get_attribute('data-return')=='',home.locator('.tile').evaluate('el=>({ticker:el.dataset.ticker,value:el.dataset.return,text:el.innerText})')
                assert '—' in home.locator('.tile').text_content()
                assert home.locator('.tile').evaluate("el=>getComputedStyle(el).backgroundColor")=='rgb(78, 89, 103)'
                home.get_by_role('button',name='조회 조건 초기화',exact=True).click()
                home.get_by_role('button',name='버블',exact=True).click()
                assert home.locator('.bubble-node').count()==partial['returnableCount']
                assert '등락률 미확보 1개 · 버블 제외' in home.locator('#map-data-status').inner_text()
                home.get_by_role('button',name='히트맵',exact=True).click()
                feeds['market']=fixture_data['market']
                page.evaluate("value => window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",fixture_data['market'])
                assert home.locator('.tile').count()==fixture_data['actualMap']['coverage']['renderableCount']
                checks.append('missing cap/FX excluded, missing comparison close neutral in heatmap and excluded from bubbles, snapshot rerenders full map')

                page.goto(origin+'/#home'); home=wait_home(page)
                previous_date=home.locator('[data-home-close-date]').inner_text()
                previous_trigger=home.locator('.ripple-trigger-card').get_attribute('data-ripple-node')
                before_requests=list(price_requests)
                assert '시세 수집 중지' in home.locator('[data-home-market-policy]').inner_text()
                page.clock.fast_forward(185000)
                page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
                assert price_requests==before_requests
                assert previous_date==home.locator('[data-home-close-date]').inner_text()
                assert home.locator('.ripple-trigger-card').get_attribute('data-ripple-node')==previous_trigger
                assert all('/data/market-display.json' in url or '/data/ripple.json' in url for url in price_requests)
                assert all('?' not in url for url in price_requests)
                checks.append('three-minute clock advance and manual refresh make zero additional price or ripple requests; stable cached archive paths only')
                feeds.update(market_status=200,ripple_status=200,market=fixture_data['calm'],ripple=fixture_data['calmRipple'])
                page.reload()
                home.locator('.ripple-empty-wide').get_by_text('오늘은 크게 움직인 대장주가 없어요',exact=True).wait_for()
                assert home.locator('[data-ripple-trigger]').count()==0
                checks.append('calm closed-price feed has explicit empty state')
                feeds.update(market=fixture_data['market'],ripple=fixture_data['ripple'])
                context.close()

                blocked=browser.new_context(ignore_https_errors=True,viewport={'width':1440,'height':1000})
                blocked.add_init_script("Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('browser fixture: storage blocked','SecurityError')}})")
                attach_routes(blocked)
                blocked_page=new_page(blocked);blocked_page.goto(origin+'/#home');blocked_home=wait_home(blocked_page)
                assert blocked_home.locator('[data-home-weight=eq]').get_attribute('aria-pressed')=='true'
                blocked_home.locator('[data-home-weight=cap]').click()
                assert blocked_home.locator('[data-home-weight=cap]').get_attribute('aria-pressed')=='true'
                blocked_page.reload();blocked_home=wait_home(blocked_page)
                assert blocked_home.locator('[data-home-weight=eq]').get_attribute('aria-pressed')=='true'
                blocked.close()
                checks.append('blocked storage keeps the page usable and reloads with the equal-weight default')

                for width in [390,820]:
                    mobile=browser.new_context(ignore_https_errors=True,viewport={'width':width,'height':980},is_mobile=True,device_scale_factor=1)
                    attach_routes(mobile)
                    phone=new_page(mobile);phone.goto(origin+'/#home');mobile_home=wait_home(phone)
                    indices = verify_header_indices(phone)
                    if width == 390:
                        assert indices.locator('[data-index-strip-cards]').evaluate('el => el.scrollWidth > el.clientWidth')
                    assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    assert mobile_home.locator('[data-ripple-flow]').evaluate("el => getComputedStyle(el).gridTemplateColumns.trim().split(/\\s+/).length === 1")
                    assert mobile_home.locator('[data-ripple-lines]').is_hidden()
                    assert mobile_home.locator('.ripple-upstream').bounding_box()['y'] < mobile_home.locator('.ripple-trigger-card').bounding_box()['y'] < mobile_home.locator('.ripple-downstream').bounding_box()['y']
                    assert mobile_home.locator('.home-ripple').evaluate('el => el.scrollWidth <= el.clientWidth + 1')
                    mobile_home.locator('[data-home-weight=cap]').click()
                    assert mobile_home.locator('[data-home-weight=cap]').get_attribute('aria-pressed')=='true'
                    phone.screenshot(path=str(output/f'home-mobile-{width}.png'),full_page=True)
                    mobile.close()
                checks.append('390px and 820px compact header indices, stacked co-movement, touch controls and no horizontal page overflow')
                assert not page_errors,page_errors
                browser.close()
            except Exception:
                for index,current in enumerate(pages):
                    try:
                        if not current.is_closed(): current.screenshot(path=str(output/f'failure-page-{index+1}.png'),full_page=True,timeout=5000)
                    except Exception: pass
                raise
        (output/'result.json').write_text(json.dumps({'passed':True,'fixtureOnly':True,'pageErrors':page_errors,'checks':checks},ensure_ascii=False,indent=2))
        print('Homepage browser acceptance passed (in-memory fixtures only). Screenshots:',output)
    finally:
        backend.terminate()
        try: backend.wait(timeout=10)
        except subprocess.TimeoutExpired: backend.kill();backend.wait()
