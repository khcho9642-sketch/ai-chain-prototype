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
import {buildRippleSnapshot} from './assets/ripple-core.js';
import {buildSectorReturns} from './assets/home-performance.js';
const DAY=86400000, now=Date.now(), stamp=new Date(now).toISOString();
const iso=ms=>new Date(ms).toISOString().slice(0,10);
const weekday=date=>![0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());
function shiftBusiness(date,count){let ms=Date.parse(date+'T12:00:00Z'),left=Math.abs(count);while(left){ms+=Math.sign(count)*DAY;if(weekday(iso(ms)))left--;}return iso(ms);}
let today=iso(now);while(!weekday(today))today=iso(Date.parse(today+'T12:00:00Z')-DAY);
const usEnd=shiftBusiness(today,-3),krEnd=shiftBusiness(usEnd,1);
function datesTo(end){const rows=[];let date=end;while(rows.length<160){if(weekday(date))rows.unshift(date);date=iso(Date.parse(date+'T12:00:00Z')-DAY);}return rows;}
const usDates=datesTo(usEnd),krDates=datesTo(krEnd);
const fxRates={USD:1,KRW:1400,JPY:150,TWD:32,EUR:.9,CHF:.85,HKD:7.8,SGD:1.3,CNY:7.1};
const quotes=COMPANIES.map((company,index)=>{
 const within=COMPANIES.filter(row=>row.sector===company.sector).findIndex(row=>row.ticker===company.ticker);
 const currency=/\.(KS|KQ)$/.test(company.ticker)?'KRW':/\.T$/.test(company.ticker)?'JPY':/\.(TW|TWO)$/.test(company.ticker)?'TWD':/\.(PA|AS)$/.test(company.ticker)?'EUR':/\.SW$/.test(company.ticker)?'CHF':/\.HK$/.test(company.ticker)?'HKD':/\.SI$/.test(company.ticker)?'SGD':/\.(SS|SZ)$/.test(company.ticker)?'CNY':'USD';
 const market=currency==='KRW'?'KR':currency==='USD'?'US':'OTHER';
 const timezone=({KRW:'Asia/Seoul',JPY:'Asia/Tokyo',TWD:'Asia/Taipei',EUR:'Europe/Paris',CHF:'Europe/Zurich',HKD:'Asia/Hong_Kong',SGD:'Asia/Singapore',CNY:'Asia/Shanghai',USD:'America/New_York'})[currency];
 const dates=market==='KR'?krDates:usDates;
 let price=100+index*3;
 const bars=dates.map((date,j)=>{
  let change=j%5===0?2.2+within*.2:.05+within*.16;
  if(company.ticker==='ASML')change=j%5===0?-3.2:-.1;
  if(j===dates.length-1){change=({NVDA:8,MU:7,DELL:6,ASML:5.5})[company.ticker]??(market==='KR'?2.1:1.2+within*.1);}
  price*=1+change/100;
  const time=Date.parse(date+(market==='US'?'T14:30:00Z':'T00:00:00Z'))/1000;
  return {time,open:price/(1+change/100),high:price*1.01,low:price*.99,close:price,volume:1000000+j};
 });
 const latest=bars.at(-1),prior=bars.at(-2),capUSD=within===4?8e12:(within+1)*1e10;
 return {symbol:company.ticker,name:company.name,currency,timezone,exchange:market==='US'?'NASDAQ':market==='KR'?'KRX':'fixture-exchange',
  price:latest.close,previousClose:prior.close,change:latest.close-prior.close,changePercent:(latest.close/prior.close-1)*100,
  closeDate:dates.at(-1),previousCloseDate:dates.at(-2),priceBasis:'previous-completed-session',range:'1y',interval:'1d',marketTime:latest.time,
  fetchedAt:stamp,source:'Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/'+encodeURIComponent(company.ticker)+'/',status:'ok',error:null,
  delayed:true,bars,histories:{},marketCap:capUSD*fxRates[currency],marketCapStatus:'ok',marketCapCurrency:currency,marketCapObservedAt:stamp,marketCapFetchedAt:stamp,marketCapBasis:'provider-current',
  marketCapHistory:dates.map(date=>({date,value:capUSD*fxRates[currency],currency,basis:'provider-dated',source:'browser-fixture'})),
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
if(actualMap.coverage.renderableCount!==64||actualMap.coverage.returnableCount!==64)throw new Error('Browser map fixture must cover all64 companies');
console.log(JSON.stringify({market,ripple,model,actualMap,calm,calmRipple,sectors:SECTORS,usEnd,krEnd}));
"""
prepared = subprocess.run(['node', '--input-type=module'], cwd=root, input=fixture_script,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
fixture_data = json.loads(prepared.stdout)
feeds = {'market': fixture_data['market'], 'ripple': fixture_data['ripple'], 'market_status': 200, 'ripple_status': 200}
page_errors = []
pages = []
checks = []

def percent(value):
    return ('+' if value > 0 else '') + f'{value:.2f}%'


def wait_home(page):
    page.locator('#v-home .sector-return-card').first.wait_for()
    page.wait_for_function("document.querySelector('#v-home')?.shadowRoot?.querySelectorAll('[data-ripple-trigger]').length === 3")
    page.wait_for_function("(() => {const cards=[...document.querySelector('#v-home').shadowRoot.querySelectorAll('.sector-return-value')];return cards.length===9 && cards.every(value=>value.textContent.trim()!=='—')})()")
    return page.locator('#v-home')


def attach_routes(context):
    def market_response(route):
        route.fulfill(status=feeds['market_status'], content_type='application/json', body=json.dumps(feeds['market']))
    def ripple_response(route):
        route.fulfill(status=feeds['ripple_status'], content_type='application/json', body=json.dumps(feeds['ripple']))
    context.route('**/api/snapshot?*', market_response)
    context.route('**/data/market.json?*', market_response)
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
            try:
                page.goto(origin+'/#home')
                home = wait_home(page)
                cards = home.locator('.sector-return-card')
                assert cards.count() == 9
                assert home.locator('[data-home-weight=eq]').get_attribute('aria-pressed') == 'true'
                assert home.locator('[data-home-card-period]').input_value() == '3mo'
                assert '586개 추적' in home.locator('[data-home-coverage]').inner_text()
                assert '핵심 45개' in home.locator('[data-home-coverage]').inner_text()
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
                assert home.locator('[data-home-card-caption]').inner_text()=='핵심 기업의 최근 1거래일 종가 수익률'
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
                assert home.locator('.tile').count()==64
                home.get_by_role('button',name='버블',exact=True).click()
                home.locator('.bubble-node').first.wait_for()
                assert home.locator('.bubble-node').count()==64
                home.get_by_role('button',name='히트맵',exact=True).click()
                home.locator('.sector-return-card[data-sector=memory]').click()
                assert home.locator('.sector-heading').count()==1
                home.locator('.sector-return-card[data-sector=memory]').click()
                assert home.locator('.sector-heading').count()==9
                home.locator('.ripple-trigger-card').click()
                page.wait_for_function("location.hash.startsWith('#company-info/company/')")
                checks.append('64 actual-cap heatmap/bubbles, exact NVDA completed return, provenance, search, sector and detail interactions')

                page.goto(origin+'/#home'); home=wait_home(page)
                incomplete=json.loads(json.dumps(fixture_data['market']))
                by_symbol={quote['symbol']:quote for quote in incomplete['quotes']}
                by_symbol['AMD']['marketCap']=None
                incomplete['fxHistory'].pop('EUR')
                by_symbol['NVDA']['bars']=by_symbol['NVDA']['bars'][-1:]
                page.evaluate("value => window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",incomplete)
                assert home.locator('.tile').count()==61
                assert '시총/환율 미확보 3' in home.locator('[data-map-coverage]').inner_text()
                assert 'AMD' in home.locator('#map-exclusions').text_content()
                assert '시총 관측일 기준 환율 미확보' in home.locator('#map-exclusions').text_content()
                home.get_by_role('searchbox',name='기업명 또는 티커 검색').fill('NVDA')
                assert '—' in home.locator('.tile').inner_text()
                assert home.locator('.tile').evaluate("el=>getComputedStyle(el).backgroundColor")=='rgb(78, 89, 103)'
                home.get_by_role('button',name='조회 조건 초기화',exact=True).click()
                home.get_by_role('button',name='버블',exact=True).click()
                assert home.locator('.bubble-node').count()==60
                assert '등락률 미확보 1개 · 버블 제외' in home.locator('#map-data-status').inner_text()
                home.get_by_role('button',name='히트맵',exact=True).click()
                page.evaluate("value => window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",fixture_data['market'])
                assert home.locator('.tile').count()==64
                checks.append('missing cap/FX excluded, missing comparison close neutral in heatmap and excluded from bubbles, snapshot rerenders full map')

                page.goto(origin+'/#home'); home=wait_home(page)
                previous_date=home.locator('[data-home-close-date]').inner_text()
                previous_trigger=home.locator('.ripple-trigger-card').get_attribute('data-ripple-node')
                feeds['ripple_status']=503
                newer=json.loads(json.dumps(feeds['market']))
                # A genuinely newer market file makes the old derived feed stale.
                newer['generatedAt']=newer['generatedAt'].replace('Z','+00:00')
                page.evaluate("value => {value.generatedAt=new Date(Date.parse(value.generatedAt)+2000).toISOString();window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}));}",newer)
                home.locator('[data-ripple-status]').filter(has_text='이전 수집값').wait_for()
                assert home.locator('.ripple-trigger-card').get_attribute('data-ripple-node')==previous_trigger
                feeds['market_status']=503
                page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
                home.locator('[data-home-close-date]').filter(has_text='이전 수집값').wait_for()
                assert previous_date.split(' 종가')[0] in home.locator('[data-home-close-date]').inner_text()
                checks.append('failed market and derived-feed refresh retain dated previous observations')
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
                    assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    assert mobile_home.locator('[data-ripple-flow]').evaluate("el => getComputedStyle(el).gridTemplateColumns.trim().split(/\\s+/).length === 1")
                    assert mobile_home.locator('[data-ripple-lines]').is_hidden()
                    assert mobile_home.locator('.ripple-upstream').bounding_box()['y'] < mobile_home.locator('.ripple-trigger-card').bounding_box()['y'] < mobile_home.locator('.ripple-downstream').bounding_box()['y']
                    assert mobile_home.locator('.home-ripple').evaluate('el => el.scrollWidth <= el.clientWidth + 1')
                    mobile_home.locator('[data-home-weight=cap]').click()
                    assert mobile_home.locator('[data-home-weight=cap]').get_attribute('aria-pressed')=='true'
                    phone.screenshot(path=str(output/f'home-mobile-{width}.png'),full_page=True)
                    mobile.close()
                checks.append('390px and 820px stacked co-movement, touch controls and no horizontal page overflow')
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
