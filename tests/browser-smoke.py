"""Optional isolated HTTPS/CORS browser smoke test. Uses fixture responses, not real AI.
Requires Python playwright, a local Chromium/Chrome and openssl. No service deployment.
Run: python tests/browser-smoke.py --browser /usr/bin/chromium
"""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--browser', default=None)
parser.add_argument('--output', default='.local/browser-smoke')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = (root / args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
errors = []

def refresh_today(page):
    """Reload the published feed through the current page; Today has no refresh control."""
    with page.expect_response(lambda response: response.url.split('?')[0].endswith('/data/today-picks.json')):
        page.reload()
    page.locator('#v-today [data-today-cards]').wait_for()
    page.wait_for_function("document.querySelectorAll('#v-today [data-today-agent]').length === 3 && !document.querySelector('#v-today').textContent.includes('발행 결과를 확인하고 있습니다.')")


def actual_today_comment(report):
    """Current Today displays the reviewed persona rewrite when its report matches."""
    personas = json.loads((root / 'data/today-personas.json').read_text(encoding='utf-8'))
    rewrite = next((row for row in personas['rewrites']
                    if row['parentId'] == report['id'] and row['symbol'] == report['symbol']), None)
    return rewrite['comment'] if rewrite else displayed_report_comment(report)['text']


def empty_today_fixture():
    return {'schemaVersion': 2, 'timezone': 'Asia/Seoul', 'editionDate': None, 'publishedAt': None,
            'picks': [], 'responses': [], 'providerStates': {agent: {'status': 'disabled', 'reason': 'provider_disabled'} for agent in ['gpt', 'claude', 'gemini']}}

def today_browser_fixture(day_offset=0):
    # In-memory schema-valid UI fixture only; never write this to public snapshots.
    at = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=day_offset)
    stamp = at.isoformat().replace('+00:00', 'Z')
    edition = (at + timedelta(hours=9)).date().isoformat()
    picks = []
    for agent, name in [('gpt', 'GPT'), ('claude', 'Claude'), ('gemini', 'Gemini')]:
        picks.append({
            'id': f'opinion-{agent}-browser', 'agent': agent, 'symbol': 'NVDA',
            'comment': f'{name} 화면 검증용 문장입니다. 실제 모델의 추천이 아니며, 각 카드가 종목 하나와 댓글 하나를 표시하는지 확인합니다.',
            'createdAt': stamp, 'dataAsOf': stamp,
            'evidence': [{'id': 'nvda-source', 'symbol': 'NVDA', 'label': '화면 검증용 자료',
                          'sourceUrl': 'https://finance.yahoo.com/quote/NVDA/', 'observedAt': stamp, 'collectedAt': stamp}],
            'provenance': {'provider': agent, 'requestedModel': agent + '-pinned', 'reportedModel': None,
                           'cliVersion': 'cli-1.0.0', 'generatedAt': stamp, 'promptVersion': 'today-v1',
                           'runId': f'run-{agent}-browser', 'execution': 'official-cli', 'reviewedAt': stamp},
        })
    responses = []
    for index, parent in enumerate(picks):
        agent, name = [('gpt', 'GPT'), ('claude', 'Claude'), ('gemini', 'Gemini')][(index + 1) % 3]
        responses.append({**parent, 'id': f'response-{agent}-browser', 'parentId': parent['id'], 'agent': agent,
                          'comment': f'{name} 화면 검증용 답글입니다. 실제 모델의 응답이 아니며, 원래 종목의 댓글 아래에 다른 AI의 답글을 표시하는지 확인합니다.',
                          'provenance': {**parent['provenance'], 'provider': agent, 'requestedModel': agent + '-pinned',
                                         'runId': f'response-run-{agent}-browser'}})
    picks[0]['fairValue'] = {'price': 150, 'currency': 'USD', 'asOf': stamp,
                             'method': '브라우저 표시 검증용 가정입니다. 실제 AI의 가격 산정이 아닙니다.',
                             'assumptions': ['브라우저 검증용 가정이며 실제 투자 판단에 사용하지 않습니다.'],
                             'evidenceIds': ['nvda-source']}
    return {'schemaVersion': 2, 'timezone': 'Asia/Seoul', 'editionDate': edition, 'publishedAt': stamp,
            'picks': picks, 'responses': responses, 'providerStates': {agent: {'status': 'ready', 'reason': 'published'} for agent in ['gpt', 'claude', 'gemini']}}

def reviewed_reports_browser_fixture():
    # Isolated display fixture. Never an inference receipt or public publication.
    value = today_browser_fixture()
    reports = []
    for agent, cli_name in [('gpt', 'codex'), ('claude', 'claude-code'), ('gemini', 'antigravity')]:
        original = next(pick for pick in value['picks'] if pick['agent'] == agent)
        comment = f'{agent} 실제 생성이 아닌 브라우저 검증용 원문 발췌입니다. 수치와 의견의 표시 범위를 확인합니다.'
        report_text = comment + '\n전체 원문 표시 검증용 문단입니다. 자동 댓글이나 모델 호출을 하지 않습니다.'
        report = {**original, 'id': f'report-{agent}-browser',
                  'kind': 'earnings-review' if agent == 'claude' else 'stock-opinion',
                  'comment': comment, 'report': report_text,
                  'reviewNotes': ['운영자 검토용 정정 문구입니다. 모델 원문과 편집자의 설명을 구분합니다.'],
                  'provenance': {**original['provenance'], 'runId': f'report-run-{agent}-browser',
                                 'cliName': cli_name, 'execution': 'owner-reviewed-one-off',
                                 'responseSha256': hashlib.sha256(report_text.encode('utf-8')).hexdigest()}}
        report.pop('fairValue', None)
        if agent != 'claude':
            report['fairValue'] = {**value['picks'][0]['fairValue'], 'price': 216.48 if agent == 'gpt' else 222}
        fresh_text = f'{agent} 새 댓글 화면 검증입니다. 분기 성적표 한 장으로 연간 졸업앨범 만들지는 말자ㅋㅋ.'
        fresh_response = fresh_text + '\r\n'
        stamp = value['publishedAt']
        report['conversationComment'] = {
            'id': f'conversation-comment-{agent}-browser', 'text': fresh_text, 'response': fresh_response,
            'sourceReportSha256': report['provenance']['responseSha256'],
            'createdAt': stamp.replace('Z', '.150Z'),
            'provenance': {**report['provenance'], 'runId': f'conversation-comment-run-{agent}-browser',
                           'generatedAt': stamp.replace('Z', '.050Z'), 'reviewedAt': stamp.replace('Z', '.100Z'),
                           'promptVersion': 'owner-conversation-v1',
                           'responseSha256': hashlib.sha256(fresh_response.encode('utf-8')).hexdigest()}}
        reports.append(report)
    previous_gemini = json.loads(json.dumps(reports[-1]))
    gemini = reports[-1]
    gemini.update(id='report-gemini-distinct-browser', symbol='AMD',
                  comment='gemini 서로 다른 AMD 종목을 고른 화면 검증용 댓글입니다. 실제 모델의 응답이 아닙니다.')
    gemini['report'] = gemini['comment'] + '\n새 종목의 독립된 원문 표시를 검증하는 문단입니다.'
    gemini['provenance'].update(runId='report-run-gemini-distinct-browser',
                                generatedAt=stamp.replace('Z', '.160Z'), reviewedAt=stamp.replace('Z', '.180Z'),
                                responseSha256=hashlib.sha256(gemini['report'].encode('utf-8')).hexdigest())
    gemini['createdAt'] = stamp.replace('Z', '.190Z')
    gemini['evidence'] = [{**gemini['evidence'][0], 'id': 'amd-source', 'symbol': 'AMD', 'sourceUrl': 'https://finance.yahoo.com/quote/AMD/'}]
    gemini['comparisonSources'] = [{'symbol': symbol, 'label': '브라우저 비교 자료',
                                    'sourceUrl': 'https://finance.yahoo.com/quote/' + symbol + '/',
                                    'observedAt': stamp, 'collectedAt': stamp} for symbol in ['VRT', 'AVGO']]
    gemini.pop('conversationComment'); gemini.pop('fairValue')
    legacy = value['picks'][0]
    legacy['symbol'] = 'VRT'
    legacy['evidence'] = [{**legacy['evidence'][0], 'id': 'vrt-source', 'symbol': 'VRT', 'sourceUrl': 'https://finance.yahoo.com/quote/VRT/'}]
    legacy['fairValue'] = {**legacy['fairValue'], 'evidenceIds': ['vrt-source']}
    value.update(schemaVersion=3, reports=reports, picks=[legacy], responses=[],
                 selectionPolicy='distinct-symbols-v1', reportHistory=[previous_gemini],
                 publishedAt=value['publishedAt'].replace('Z', '.200Z'))
    return value


def displayed_report_comment(report):
    return report.get('conversationComment') or {'id': report['id'], 'text': report['comment'],
                                                'provenance': report['provenance'], 'createdAt': report['createdAt']}


def structured_report(report):
    text = report['report'].strip()
    if text.startswith('```json\n') and text.endswith('\n```'):
        text = text[len('```json\n'):-len('\n```')]
    return json.loads(text)


def recommendation_only_browser_fixture():
    # Current selections have separate fresh runs; all former reports remain in history.
    value = reviewed_reports_browser_fixture()
    gpt, claude, gemini = value['reports']
    history = json.loads(json.dumps([gpt, claude] + value['reportHistory']))
    gpt.update(id='report-gpt-fresh-distinct-browser',
               comment='gpt 새로운 엔비디아 선택을 검증하는 댓글입니다. 실제 모델의 답변이 아닙니다.')
    gpt['report'] = gpt['comment'] + '\n새 날짜의 실제 생성 출처를 구분하는 화면 검증 문단입니다.'
    gpt['provenance'].update(runId='report-run-gpt-fresh-distinct-browser',
                             generatedAt=value['publishedAt'], reviewedAt=value['publishedAt'],
                             responseSha256=hashlib.sha256(gpt['report'].encode('utf-8')).hexdigest())
    gpt['createdAt'] = value['publishedAt']
    gpt.pop('conversationComment'); gpt.pop('fairValue', None)
    gemini['provenance'].update(cliName='gemini-web', cliVersion=None, requestedModel='Gemini 웹 Pro')
    value.update(reports=[gpt, gemini], reportHistory=history)
    value['providerStates']['claude'] = {'status': 'disabled', 'reason': 'terms_not_cleared'}
    return value


def enable_fixture_community_runtime(context, api_origin):
    """Opt this isolated test context into fixture APIs; never edit public runtime files."""
    assert api_origin.startswith('https://localhost:'), api_origin
    context.route('**/assets/community-runtime.js', lambda route: route.fulfill(
        status=200, content_type='application/javascript',
        body='// Loopback browser fixture only. Never written to application assets.\n'
             + 'export const communityApiOrigin = ' + json.dumps(api_origin) + ';\n'))
    context.route('**/assets/site-runtime.js', lambda route: route.fulfill(
        status=200, content_type='application/javascript', body="""
// Browser integration fixture only. Never written to application assets.
export const realtimeEnabled = true;
export const staticHost = typeof location !== 'undefined' &&
  (location.hostname.endsWith('.github.io') || location.protocol === 'file:');
"""))


def verify_paused_static_runtime(browser, origin, captured_pages):
    """Exercise the actual default false switch before any fixture-only opt-in."""
    paused = browser.new_context(ignore_https_errors=True,
                                 viewport={'width': 1440, 'height': 1000})
    current = paused.new_page()
    captured_pages.append(current)
    current.on('pageerror', lambda error: errors.append(str(error)))
    requests = []
    current.on('request', lambda request: requests.append((request.method, request.url)))
    # Any regression is recorded and blocked from reaching even the fixture backend.
    current.route('**/api/**', lambda route: route.fulfill(
        status=503, content_type='application/json', body='{"error":"paused_runtime_fixture"}'))
    current.clock.install()
    current.add_init_script("""(() => {
      const probe = window.__pausedRuntimeProbe = {eventSources: 0, intervals: []};
      const originalInterval = window.setInterval;
      window.setInterval = (callback, delay, ...args) => {
        probe.intervals.push(delay);
        return originalInterval(callback, delay, ...args);
      };
      if (window.EventSource) window.EventSource = new Proxy(window.EventSource, {
        construct(target, args, newTarget) {
          probe.eventSources++;
          return Reflect.construct(target, args, newTarget);
        },
      });
    })();""")
    current.goto(origin + '/')
    current.wait_for_function('window.aiChainSnapshot?.quotes?.length > 0')
    assert current.evaluate("async () => (await import('./assets/site-runtime.js')).realtimeEnabled") is False
    assert current.evaluate("async () => (await import('./assets/community-runtime.js')).communityApiOrigin") == ''
    strip = current.locator('[data-index-strip]')
    strip.wait_for()
    current.wait_for_function("document.querySelectorAll('[data-index-strip] [data-index-symbol]').length === 5")
    assert current.locator('[data-index-strip] [data-index-symbol]').count() == 5
    assert current.locator('[data-index-strip] [data-index-symbol]').evaluate_all(
        'cards => cards.map(card => card.dataset.indexSymbol)') == ['^IXIC', '^GSPC', '^SOX', '^KS11', '^KQ11']
    assert current.evaluate("""() => {
      const strip = document.querySelector('[data-index-strip]');
      const header = document.querySelector('body > header');
      return !strip.closest('.view') &&
        Boolean(strip.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        strip.getBoundingClientRect().bottom <= header.getBoundingClientRect().top + 1;
    }""")
    assert '실시간 갱신 중지' in strip.inner_text()
    saved_indices = strip.locator('[data-index-strip-cards]').inner_text()
    current.set_viewport_size({'width': 390, 'height': 844})
    assert current.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    assert strip.bounding_box()['width'] <= 391
    assert strip.locator('[data-index-strip-cards]').evaluate('el => el.scrollWidth > el.clientWidth')
    current.set_viewport_size({'width': 1440, 'height': 1000})
    current.locator('.topnav [data-r=today]').click()
    current.wait_for_function("document.querySelectorAll('#v-today [data-today-cards] [data-today-comment]').length === 3")
    assert strip.is_visible()
    assert strip.locator('[data-index-strip-cards]').inner_text() == saved_indices
    current.locator('#v-today [data-recommendation-comments]').first.locator('summary').click()
    current.locator('#v-today').get_by_text('댓글 기능은 일시 중지되어 있습니다.', exact=True).first.wait_for()
    current.evaluate("location.hash = 'talk/NVDA'")
    current.locator('#v-talk').get_by_text('댓글·회원·AI 실시간 기능은 일시 중지되어 있습니다.', exact=True).wait_for()
    current.evaluate("location.hash = 'debate'")
    current.locator('#v-debate').wait_for(state='visible')
    # A visible SPA shell and an already-reached networkidle state do not mean its first publication has loaded.
    current.locator('#v-debate .debate-topic').wait_for(state='visible')
    current.locator('#v-debate [data-debate-stance]').first.wait_for(state='visible')
    current.locator('#v-debate .debate-character-history').wait_for(state='visible')
    current.wait_for_load_state('networkidle')
    data_reads = [url for _, url in requests if '/data/' in url]
    current.clock.fast_forward(185000)
    assert [url for _, url in requests if '/data/' in url] == data_reads, {'before': data_reads, 'after': [url for _, url in requests if '/data/' in url]}
    assert not any('/api/' in url for _, url in requests), requests
    assert not any(method != 'GET' for method, _ in requests), requests
    assert current.evaluate('window.__pausedRuntimeProbe') == {'eventSources': 0, 'intervals': []}
    current.evaluate("location.hash = 'home'")
    current.locator('#v-home').wait_for(state='visible')
    current.screenshot(path=str(output / 'paused-indices-above-chapters.png'), full_page=True)
    paused.close()


@contextmanager
def capture_failure_pages():
    pages = []
    try:
        yield pages
    except Exception:
        for index, current in enumerate(pages):
            try:
                if not current.is_closed():
                    current.screenshot(path=str(output / f'failure-page-{index + 1}.png'), full_page=True, timeout=5000)
            except Exception:
                pass  # Keep the original assertion or browser error as the failure.
        raise

with tempfile.TemporaryDirectory(prefix='ai-chain-browser-') as temp:
    key, cert = Path(temp) / 'key.pem', Path(temp) / 'cert.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key), '-out', str(cert), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env = dict(os.environ, COMMUNITY_BROWSER_FIXTURE='1', SMOKE_TLS_KEY=str(key), SMOKE_TLS_CERT=str(cert))
    fixture = subprocess.Popen(['node', 'tests/helpers/browser-server.mjs'], cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    try:
        endpoints = json.loads(fixture.stdout.readline())
        origin = endpoints['siteOrigin']
        with sync_playwright() as p, capture_failure_pages() as captured_pages:
            browser = p.chromium.launch(executable_path=args.browser or shutil.which('google-chrome') or shutil.which('chromium') or p.chromium.executable_path, headless=True, args=['--no-sandbox'])
            verify_paused_static_runtime(browser, origin, captured_pages)
            context = browser.new_context(ignore_https_errors=True, viewport={'width': 1440, 'height': 1000})
            enable_fixture_community_runtime(context, endpoints['apiOrigin'])
            page = context.new_page()
            captured_pages.append(page)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/api/chart?*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"browser fixture: external quote lookup disabled"}'))
            market_fixture = {'status': 200, 'value': json.loads((root / 'data/market.json').read_text(encoding='utf-8'))}
            market_quote = next(quote for quote in market_fixture['value']['quotes'] if quote['symbol'] == 'NVDA')
            market_quote.update(price=123.45, currency='USD', marketTime=int(datetime.now(timezone.utc).timestamp()) - 60,
                                delayed=True, status='ok', source='Yahoo Finance', error=None)
            def serve_market_fixture(route):
                status = market_fixture.get('api_status', market_fixture['status']) if '/api/snapshot?' in route.request.url else market_fixture['status']
                route.fulfill(status=status, content_type='application/json', body=json.dumps(market_fixture['value']))
            page.route('**/api/snapshot?*', serve_market_fixture)
            page.route('**/data/market.json?*', serve_market_fixture)
            page.route('**/data/market-display.json', serve_market_fixture)
            page.route('**/data/today-picks.json', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(empty_today_fixture())))
            home_requests = []
            page.on('request', lambda request: home_requests.append((request.method, request.url)))
            page.goto(origin + '/')
            assert page.locator('#v-home').is_visible()
            assert page.evaluate("""async () => {
              const {MARKET_DATA_POLICY: policy} = await import('./assets/market-data-policy.js');
              return policy.collectionEnabled || policy.liveRequestsEnabled || policy.autoRefreshEnabled;
            }""") is False
            assert page.locator('#v-today').is_hidden()
            page.locator('.topnav [data-r=today]').click()
            today = page.locator('#v-today')
            today.locator('[data-today-cards]').wait_for()
            today.get_by_text('추천 미발행', exact=True).first.wait_for()
            assert today.locator('[data-today-agent]').count() == 3
            assert today.locator('[data-today-comment]').count() == 0
            assert today.locator('.today-agent-style').count() == 0
            assert not any(style in today.inner_text() for style in ['펨코 느낌', '디시 느낌', '블라인드 느낌'])
            assert page.locator('#v-map').is_hidden()
            refresh_today(page)
            assert not any(method != 'GET' or '/api/community/worker/' in url for method, url in home_requests)
            page.screenshot(path=str(output / 'today-desktop.png'), full_page=True)
            page.wait_for_function("window.aiChainSnapshot?.quotes?.length > 0")
            # Comparison is a read-only consumer of collected histories, with no per-company lookup.
            comparison = page.locator('#v-compare')
            comparison_history_requests = []
            page.on('request', lambda request: comparison_history_requests.append(request.url)
                    if '/api/comparison-history' in request.url or '/data/comparison-history.json' in request.url else None)
            comparison_fixture = {'status': 200, 'value': page.evaluate("""async () => {
              const {instruments} = await import('./assets/instruments.js');
              const end = Math.floor(Date.now() / 86400000) * 86400 - 43200;
              const stamp = new Date().toISOString();
              const quotes = instruments.filter(item => item.chains.some(id => id > 0)).map((item, i) => ({
                symbol:item.symbol, name:item.name, currency:'USD', timezone:'UTC',
                range:'3y', interval:'1d', source:'Yahoo Finance',
                sourceUrl:'https://finance.yahoo.com/quote/' + encodeURIComponent(item.symbol) + '/',
                fetchedAt:stamp, status:'ok', error:null,
                bars:Array.from({length:item.symbol === 'SNDK' ? 420 : 1100}, (_, j) => {
                  const count = item.symbol === 'SNDK' ? 420 : 1100;
                  return {time:end - (count - 1 - j) * 86400, close:100 + i + j * (i % 3 + 1) / 10};
                })
              }));
              return {schemaVersion:1, range:'3y', interval:'1d', generatedAt:stamp, source:'Yahoo Finance', quotes};
            }""")}
            def serve_comparison_fixture(route):
                route.fulfill(status=comparison_fixture['status'], content_type='application/json',
                              body=json.dumps(comparison_fixture['value'], ensure_ascii=False))
            page.route('**/api/comparison-history?*', serve_comparison_fixture)
            page.route('**/data/comparison-history.json?*', serve_comparison_fixture)
            page.route('**/data/comparison-history.json', serve_comparison_fixture)
            def show_company_chain(scope, chain):
                picker = scope.locator('[data-peer-company-picker]')
                if picker.get_attribute('open') is None:
                    picker.locator(':scope > summary').click()
                button = scope.locator('[data-peer-jump="' + str(chain) + '"]')
                if button.get_attribute('aria-expanded') != 'true':
                    button.click()

            page.evaluate("location.hash = 'compare'")
            comparison.get_by_role('heading', name='회사별 주가 흐름 비교', exact=True).wait_for()
            comparison.locator('#peer-chart [data-peer-series="000660.KS"]').wait_for()
            assert comparison.locator('.peer-card').count() == 8
            assert comparison.locator('[data-peer-mode=companies]').get_attribute('aria-pressed') == 'true'
            assert comparison.locator('[data-peer-period="90"]').get_attribute('aria-pressed') == 'true'
            assert set(comparison.locator('[data-peer-series]').evaluate_all('els => els.map(el => el.dataset.peerSeries)')) == {'005930.KS', '000660.KS'}
            picker = comparison.locator('[data-peer-company-picker]')
            assert picker.get_attribute('open') is not None
            assert picker.locator('[data-peer-jump]:visible').count() == 8
            assert picker.locator('[data-peer-jump][aria-expanded="true"]').count() == 0
            assert comparison.locator('[data-peer-picker-panel]').is_hidden()
            assert comparison.locator('[data-peer-picker-list]').is_hidden()
            assert picker.locator('.peer-card:visible').count() == 0
            assert comparison.locator('.peer-selection').is_hidden()
            assert comparison.locator('[data-peer-series="005930.KS"]').get_attribute('stroke') != comparison.locator('[data-peer-series="000660.KS"]').get_attribute('stroke')
            assert comparison.locator('#peer-chart').bounding_box()['y'] < page.viewport_size['height'] - 140
            samsung = comparison.locator('[data-peer-symbol="005930.KS"]')
            assert samsung.count() == 2
            assert all(samsung.nth(i).is_checked() for i in range(samsung.count()))
            assert not comparison_history_requests
            page.screenshot(path=str(output / 'comparison-default-companies-desktop.png'))
            # Only the eight chains appear first; one chain opens its companies and toggles closed.
            show_company_chain(comparison, 3)
            assert picker.locator('.peer-card:visible').count() == 1
            assert picker.locator('[data-peer-chain="3"]').is_visible()
            assert picker.locator('[data-peer-jump="3"]').get_attribute('aria-expanded') == 'true'
            assert picker.locator('[data-peer-jump="3"]').get_attribute('aria-controls') == 'peer-picker-panel'
            picker.locator('[data-peer-jump="3"]').click()
            assert comparison.locator('[data-peer-picker-panel]').is_hidden()
            assert picker.locator('[data-peer-jump][aria-expanded="true"]').count() == 0
            assert comparison.locator('[data-peer-series]').count() == 2
            # Defaults seed the first visit only: removing a company survives period and mode changes.
            show_company_chain(comparison, 3)
            comparison.locator('[data-peer-symbol="000660.KS"]').uncheck()
            comparison.locator('[data-peer-period="30"]').click()
            assert comparison.locator('[data-peer-remove-symbol]').count() == 1
            assert comparison.locator('[data-peer-series="000660.KS"]').count() == 0
            picker.locator(':scope > summary').click()
            comparison.locator('[data-peer-period="90"]').click()
            assert picker.get_attribute('open') is None
            comparison.locator('[data-peer-mode=groups]').click()
            comparison.get_by_role('heading', name='8개 고리 주가 흐름 비교', exact=True).wait_for()
            assert comparison.locator('.peer-card').count() == 8
            comparison.locator('[data-peer-mode=companies]').click()
            assert comparison.locator('[data-peer-remove-symbol]').count() == 1
            assert not comparison.locator('[data-peer-symbol="000660.KS"]').is_checked()
            show_company_chain(comparison, 3)
            comparison.locator('[data-peer-clear-companies]').click()
            comparison.locator('[data-peer-period="30"]').click()
            comparison.locator('[data-peer-period="90"]').click()
            assert comparison.locator('[data-peer-empty]').is_visible()
            assert comparison.locator('#peer-chart').count() == 0
            assert comparison.locator('[data-peer-remove-symbol]').count() == 0
            show_company_chain(comparison, 2)
            samsung.first.check()
            assert all(samsung.nth(i).is_checked() for i in range(samsung.count()))
            show_company_chain(comparison, 4)
            comparison.locator('[data-peer-symbol="NVDA"]').first.check()
            assert comparison.locator('[data-peer-remove-symbol]').count() == 2
            assert comparison.locator('[data-peer-series="005930.KS"]').count() == 1
            assert comparison.locator('[data-peer-series="NVDA"]').count() == 1
            # Picking stays above the chart and keeps its own scroll/focus after each check.
            picker = comparison.locator('[data-peer-company-picker]')
            picker_list = comparison.locator('[data-peer-picker-list]')
            assert picker.locator('.peer-card').count() == 8
            assert comparison.locator('.peer-card').count() == 8
            assert comparison.evaluate("el => el.querySelector('[data-peer-company-picker]').getBoundingClientRect().bottom <= el.querySelector('#peer-chart').getBoundingClientRect().top")
            assert 0 < picker_list.evaluate('el => el.clientHeight') <= 320
            show_company_chain(comparison, 8)
            assert picker.locator('.peer-card:visible').count() == 1
            assert picker.locator('[data-peer-chain="8"]').is_visible()
            assert picker.locator('[data-peer-chain="4"]').is_hidden()
            assert picker.locator('[data-peer-jump="4"]').get_attribute('aria-expanded') == 'false'
            assert picker_list.evaluate('el => el.scrollTop') == 0
            picker_list.evaluate('el => { el.scrollTop = el.scrollHeight }')
            picker_scroll = picker_list.evaluate('el => el.scrollTop')
            comparison.locator('[data-peer-symbol="035720.KS"]').check()
            assert abs(picker_list.evaluate('el => el.scrollTop') - picker_scroll) <= 2
            assert page.evaluate("document.activeElement?.dataset.peerSymbol") == '035720.KS'
            comparison.locator('[data-peer-remove-symbol="035720.KS"]').click()
            picker.locator(':scope > summary').click()
            comparison.locator('[data-peer-period="90"]').click()
            assert picker.get_attribute('open') is None
            picker.locator(':scope > summary').click()
            comparison.locator('[data-peer-period="1095"]').click()
            comparison.locator('#peer-chart [data-peer-series="NVDA"]').wait_for()
            page.wait_for_function("!document.querySelector('[data-peer-refresh]').disabled")
            assert len(comparison_history_requests) == 1
            assert comparison.locator('[data-peer-period="1095"]').get_attribute('aria-pressed') == 'true'
            assert comparison.locator('[data-peer-actual-period]').inner_text().count('공통 거래일') == 1
            assert comparison.locator('[data-peer-remove-symbol]').count() == 2
            comparison.locator('[data-peer-period="730"]').click()
            comparison.locator('[data-peer-period="1095"]').click()
            assert len(comparison_history_requests) == 1
            # Sector calculations retain full 3-year coverage; a young listing can shorten only company mode.
            comparison.locator('[data-peer-mode=groups]').click()
            assert comparison.locator('.peer-card').count() == 8
            assert '선택 기간 이력 부족' in comparison.locator('[data-peer-row="SNDK"]').inner_text()
            assert '관측 이력:' in comparison.locator('[data-peer-observed-period="SNDK"]').inner_text()
            comparison.locator('[data-peer-symbol="SNDK"]').first.check()
            assert comparison.locator('[data-peer-mode=companies]').get_attribute('aria-pressed') == 'true'
            comparison.locator('.peer-period-warning').wait_for()
            # Selected rows use the company model's shortened dates, exactly as its legend does.
            nvda_legend_return = comparison.locator('[data-peer-toggle="NVDA"] b').inner_text()
            assert comparison.locator('[data-peer-company-return="NVDA"]').first.inner_text() == nvda_legend_return
            slider = comparison.locator('#peer-date-slider')
            slider.evaluate("el => { el.value = '0'; el.dispatchEvent(new Event('input', {bubbles:true})); }")
            assert '+0.00%' not in comparison.locator('#peer-date-values').inner_text()
            assert comparison.locator('#peer-date-values').inner_text().count('0.00%') == 3
            # A stopped collector keeps the cached archive and never redownloads it on refresh.
            comparison_fixture['status'] = 503
            requests_before_refresh=len(comparison_history_requests)
            comparison.locator('[data-peer-refresh]').click()
            assert len(comparison_history_requests)==requests_before_refresh
            assert comparison.locator('[data-peer-series="NVDA"]').count() == 1
            assert comparison.locator('[data-peer-remove-symbol]').count() == 3
            comparison_fixture['status'] = 200
            comparison.locator('[data-peer-refresh]').click()
            assert len(comparison_history_requests)==requests_before_refresh
            assert comparison.locator('[data-peer-remove-symbol]').count() == 3
            comparison.locator('[data-peer-remove-symbol="005930.KS"]').click()
            assert all(not samsung.nth(i).is_checked() for i in range(samsung.count()))
            comparison.locator('[data-peer-clear-companies]').click()
            assert comparison.locator('[data-peer-empty]').is_visible()
            assert comparison.locator('#peer-chart').count() == 0
            # More than twelve selected companies all remain drawn; only crowded end labels are omitted.
            comparison.evaluate("""el => {
              const seen = new Set();
              for (const input of [...el.querySelectorAll('[data-peer-symbol]')]) {
                const symbol = input.dataset.peerSymbol;
                if (seen.has(symbol)) continue;
                seen.add(symbol);
                const current = document.querySelector('[data-peer-symbol="' + CSS.escape(symbol) + '"]');
                current.checked = true; current.dispatchEvent(new Event('change', {bubbles:true}));
                if (seen.size === 14) break;
              }
            }""")
            assert comparison.locator('[data-peer-remove-symbol]').count() == 14
            assert comparison.locator('[data-peer-series]').count() == 14
            assert comparison.locator('.peer-end-label').count() == 0
            page.screenshot(path=str(output / 'comparison-companies-desktop.png'), full_page=True)
            comparison.locator('[data-peer-clear-companies]').click()
            comparison.locator('[data-peer-mode=groups]').click()
            page.evaluate("location.hash = 'today'")
            today.locator('[data-today-cards]').wait_for()
            # Exercise populated cards through a browser-only response, never real AI or public file writes.
            today_fixture = {'value': today_browser_fixture(), 'status': 200}
            def serve_today_fixture(route):
                route.fulfill(status=today_fixture['status'], content_type='application/json', body=json.dumps(today_fixture['value'], ensure_ascii=False))
            page.route('**/data/today-picks.json', serve_today_fixture)
            refresh_today(page)
            for pick in today_fixture['value']['picks']:
                card = today.locator('[data-today-agent="' + pick['agent'] + '"]')
                card.get_by_text(pick['comment'], exact=True).wait_for()
                assert card.locator('[data-today-comment]').count() == 1
                assert card.get_attribute('data-pick-id') == pick['id']
                assert card.locator('.today-initial-comment time').count() == 0
                card.get_by_text('123.45 USD', exact=True).wait_for()
                assert '지연 시세' in card.locator('[data-today-field=price]').inner_text()
                assert 'KST' in card.locator('[data-today-price-as-of]').inner_text()
                assert card.locator('.today-price-fields dt').all_inner_texts() == ['현재 시가', '시가 기준일', 'AI 추정 가격', '시가 대비 추정 차이']
                assert card.locator('[data-today-fair-value]').inner_text() == ('150 USD' if pick['agent'] == 'gpt' else '미산정')
                assert card.locator('[data-today-estimate-gap]').inner_text() == ('+21.51%' if pick['agent'] == 'gpt' else '—')
                assert card.locator('[data-today-field=estimate-gap]').get_attribute('data-estimate-state') == ('above' if pick['agent'] == 'gpt' else 'missing')
                assert ('추정 가격이 시가보다 높음' if pick['agent'] == 'gpt' else '가격 추정 보류') in card.locator('[data-today-field=estimate-gap]').inner_text()
                assert card.locator('.today-initial-comment > .today-message-label').inner_text() == '의견'
            assert today.locator('[data-today-comment]').count() == 3
            assert today.locator('[data-today-response]').count() == 3
            # The collector is paused; explicit in-memory archive events still update display logic.
            market_quote['price'] = 124.56
            page.evaluate("value=>window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",market_fixture['value'])
            today.locator('[data-today-agent=gpt]').get_by_text('124.56 USD', exact=True).wait_for()
            assert today.locator('[data-today-agent=gpt] [data-today-estimate-gap]').inner_text() == '+20.42%'
            page.evaluate("window.dispatchEvent(new CustomEvent('market-snapshot-error',{detail:'browser fixture: stored archive unavailable'}))")
            today.locator('[data-today-agent=gpt]').get_by_text('이전 확인값 · 조회 실패 · 지연 시세 · Yahoo Finance', exact=True).wait_for()
            assert today.locator('[data-today-agent=gpt] [data-today-price]').inner_text() == '124.56 USD'
            assert today.locator('[data-today-agent=gpt] [data-today-estimate-gap]').inner_text() == '—'
            assert '비교 불가' in today.locator('[data-today-agent=gpt] [data-today-field=estimate-gap]').inner_text()
            page.evaluate("value=>window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",market_fixture['value'])
            page.wait_for_function("!document.querySelector('[data-today-agent=gpt] [data-today-field=price]').textContent.includes('조회 실패')")
            # Compare the unchanged estimate honestly, including nonzero differences that round to zero.
            for current_price, expected_gap, expected_state in [(151, '−0.66%', 'below'), (150, '0.00%', 'equal'),
                                                               (149.999, '+0.01% 미만', 'above'), (150.001, '−0.01% 미만', 'below')]:
                market_quote['price'] = current_price
                page.evaluate("value=>window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",market_fixture['value'])
                today.locator('[data-today-agent=gpt]').get_by_text(expected_gap, exact=True).wait_for()
                gap = today.locator('[data-today-agent=gpt] [data-today-field=estimate-gap]')
                assert gap.get_attribute('data-estimate-state') == expected_state
                assert ('추정 가격이 시가보다 높음' if expected_state == 'above' else '상승 여력 조건 미충족') in gap.inner_text()
                assert today.locator('[data-today-agent=gpt] [data-today-fair-value]').inner_text() == '150 USD'
            market_quote.update(price=124.56, currency='KRW')
            page.evaluate("value=>window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",market_fixture['value'])
            today.locator('[data-today-agent=gpt]').get_by_text('124.56 KRW', exact=True).wait_for()
            assert '비교 불가' in today.locator('[data-today-agent=gpt] [data-today-field=estimate-gap]').inner_text()
            assert today.locator('[data-today-agent=gpt] [data-today-estimate-gap]').inner_text() == '—'
            market_quote['currency'] = 'USD'
            page.evaluate("value=>window.dispatchEvent(new CustomEvent('market-snapshot',{detail:value}))",market_fixture['value'])
            today.locator('[data-today-agent=gpt]').get_by_text('+20.42%', exact=True).wait_for()
            for response in today_fixture['value']['responses']:
                parent_card = today.locator('[data-pick-id="' + response['parentId'] + '"]')
                reply = parent_card.locator('[data-today-response="' + response['id'] + '"]')
                reply.get_by_text(response['comment'], exact=True).wait_for()
                assert reply.get_attribute('data-parent-id') == response['parentId']
                assert reply.locator('[data-today-response-comment]').count() == 1
                assert reply.locator('time').count() == 0
                assert '실제 생성 ' in reply.locator('.today-source-content').text_content()
                assert reply.locator('[data-today-response]').count() == 0
                assert 'AI' in reply.locator('.today-agent-heading strong').inner_text()
            today_gpt = today.locator('[data-today-agent=gpt]')
            today_gpt.locator('.today-initial-comment > .today-sources > summary').click()
            today_gpt.get_by_text('요청 모델 gpt-pinned', exact=True).wait_for()
            today_gpt.locator('.today-initial-comment .today-source-content').get_by_text('실제 모델명 미확인', exact=True).wait_for()
            today_source = today_gpt.locator('.today-initial-comment').get_by_role('link', name='근거 원문 ↗', exact=True)
            assert today_source.get_attribute('href') == 'https://finance.yahoo.com/quote/NVDA/'
            assert today_source.get_attribute('target') == '_blank'
            assert {'noopener', 'noreferrer'} <= set(today_source.get_attribute('rel').split())
            today_reply = today_gpt.locator('[data-today-response]')
            today_reply.locator('.today-sources > summary').click()
            today_reply.get_by_text('요청 모델 claude-pinned', exact=True).wait_for()
            today_reply.locator('.today-source-content').get_by_text('실제 모델명 미확인', exact=True).wait_for()
            page.screenshot(path=str(output / 'today-populated-fixture-desktop.png'), full_page=True)
            assert today_gpt.get_by_role('button', name='종목 · 차트', exact=False).count() == 0
            assert today_gpt.get_by_role('link', name='생각 나누기 →', exact=True).count() == 0
            today_fixture['value'] = today_browser_fixture()
            today_fixture['value']['responses'][0]['parentId'] = 'not-a-published-parent'
            refresh_today(page)
            today.get_by_text('발행 자료를 확인할 수 없습니다.', exact=True).first.wait_for()
            assert today.locator('[data-today-comment]').count() == 0
            assert today.locator('[data-today-response]').count() == 0
            today_fixture['value'] = today_browser_fixture(day_offset=-1)
            refresh_today(page)
            today.locator('[data-today-agent=gpt]').get_by_text('오늘의 추천은 아직 없습니다.', exact=True).wait_for()
            assert today.locator('[data-today-cards] [data-today-comment]').count() == 0
            assert today.locator('[data-today-cards] [data-today-response]').count() == 0
            today.locator('[data-today-archive] > summary').click()
            assert today.locator('[data-today-archive-agent]').count() == 3
            assert today.locator('[data-today-archive] [data-today-comment]').count() == 3
            assert today.locator('[data-today-archive] [data-today-response]').count() == 3
            assert today.locator('[data-today-archive] [data-today-estimate-gap]').count() == 0
            today_fixture['status'] = 503
            refresh_today(page)
            today.get_by_text('발행 자료를 확인할 수 없습니다.', exact=True).first.wait_for()
            assert today.locator('[data-today-comment]').count() == 0
            assert today.locator('[data-today-response]').count() == 0
            assert today.locator('[data-today-archive]').is_hidden()
            # One-off reports share existing cards and retain earlier publications.
            today_fixture.update(status=200, value=reviewed_reports_browser_fixture())
            refresh_today(page)
            today.locator('[data-today-agent=gemini] .today-ticker').wait_for()
            assert today.locator('[data-today-cards] [data-today-comment]').count() == 3
            assert today.locator('[data-today-cards] [data-today-response]').count() == 0
            assert today.locator('[data-today-agent=gpt] .today-company .today-ticker').inner_text() == 'NVDA'
            assert today.locator('[data-today-agent=gemini] .today-company .today-ticker').inner_text() == 'AMD'
            claude_card = today.locator('[data-today-agent=claude]')
            claude_card.get_by_role('heading', name='추천 미발행', exact=True).wait_for()
            assert claude_card.get_attribute('data-recommendation-state') == 'unpublished'
            assert claude_card.locator('.today-company').is_hidden()
            assert claude_card.locator('[data-today-price]').is_hidden()
            assert claude_card.locator('[data-today-comment]').is_hidden()
            claude_card.locator('[data-today-factual-review] > summary').click()
            for report in today_fixture['value']['reports']:
                card = today.locator('[data-today-agent="' + report['agent'] + '"]')
                fresh_comment = displayed_report_comment(report)
                assert card.locator('[data-today-comment]').inner_text() == fresh_comment['text']
                if report.get('conversationComment'):
                    assert card.locator('[data-today-comment]').inner_text() != report['comment']
                assert card.locator('.today-review-notes').count() == 0
                assert card.locator('.today-message-label').first.inner_text() == {'gpt': 'GPT', 'claude': 'Claude', 'gemini': 'Gemini'}[report['agent']] + ' · AI'
                assert not any(label in card.inner_text() for label in ['원문 발췌', '펨코 느낌', '디시 느낌', '블라인드 느낌'])
                assert card.locator('.today-report-original').count() == 0
                assert card.locator('.today-initial-comment time').count() == 0
                assert card.locator('[data-today-fair-value]').inner_text() == {
                    'gpt': '216.48 USD', 'claude': '가격 평가 없음', 'gemini': '미산정'}[report['agent']]
                card.locator('.today-initial-comment > .today-sources > summary').click()
                cli_label = {'gpt': 'Codex', 'claude': 'Claude Code', 'gemini': 'Antigravity'}[report['agent']]
                card.get_by_text('CLI ' + cli_label + ' cli-1.0.0', exact=True).wait_for()
                if report.get('comparisonSources'):
                    card.get_by_text('비교에 사용한 타사 원문', exact=True).wait_for()
                    comparison_links = card.get_by_role('link', name='비교 자료 원문 ↗', exact=True)
                    assert comparison_links.count() == len(report['comparisonSources'])
                    assert [comparison_links.nth(index).get_attribute('href') for index in range(comparison_links.count())] == [source['sourceUrl'] for source in report['comparisonSources']]
                if report.get('conversationComment'):
                    card.get_by_text('댓글 작성 출처', exact=True).wait_for()
                    card.get_by_text('CLI ' + fresh_comment['provenance']['cliName'] + ' · cli-1.0.0', exact=True).wait_for()
                    card.get_by_text('댓글 SHA-256 ' + fresh_comment['provenance']['responseSha256'], exact=True).wait_for()
            assert today.locator('[data-today-archive]').is_visible()
            if today.locator('[data-today-archive]').get_attribute('open') is None:
                today.locator('[data-today-archive] > summary').click()
            assert today.locator('[data-today-archive] [data-today-comment]').count() == 2
            assert today.locator('[data-today-archive-agent=gpt] [data-today-comment]').inner_text() == today_fixture['value']['picks'][0]['comment']
            assert today.locator('[data-today-archive-agent=gpt] .today-ticker').inner_text() == 'VRT'
            historical_gemini = today_fixture['value']['reportHistory'][0]
            assert today.locator('[data-today-archive-agent=gemini] .today-ticker').inner_text() == 'NVDA'
            assert today.locator('[data-today-archive-agent=gemini] [data-today-comment]').inner_text() == displayed_report_comment(historical_gemini)['text']
            page.screenshot(path=str(output / 'today-reviewed-reports-fixture-desktop.png'), full_page=True)
            # Production-shaped replacement: two distinct current picks and all three prior reports.
            today_fixture['value'] = recommendation_only_browser_fixture()
            refresh_today(page)
            today.locator('[data-today-agent=gpt]').get_by_text(today_fixture['value']['reports'][0]['comment'], exact=True).wait_for()
            assert today.locator('[data-today-cards] [data-today-comment]').count() == 2
            assert today.locator('[data-today-agent=gpt] .today-company .today-ticker').inner_text() == 'NVDA'
            assert today.locator('[data-today-agent=gemini] .today-company .today-ticker').inner_text() == 'AMD'
            inactive_claude = today.locator('[data-today-agent=claude]')
            assert today.locator('[data-today-agent=gpt] [data-today-fair-value]').inner_text() == '미산정'
            assert today.locator('[data-today-agent=gemini] [data-today-fair-value]').inner_text() == '미산정'
            inactive_claude.get_by_role('heading', name='추천 미발행', exact=True).wait_for()
            assert inactive_claude.locator('.today-company').count() == 0
            assert inactive_claude.locator('[data-today-comment]').count() == 0
            assert inactive_claude.locator('[data-today-factual-review]').count() == 0
            if today.locator('[data-today-archive]').get_attribute('open') is None:
                today.locator('[data-today-archive] > summary').click()
            assert today.locator('[data-today-archive] [data-today-comment]').count() == 4
            assert today.locator('[data-today-archive-agent=gpt]').count() == 2
            assert today.locator('[data-today-archive-agent=claude]').count() == 1
            assert today.locator('[data-today-archive-agent=gemini]').count() == 1
            for previous_report in today_fixture['value']['reportHistory']:
                today.locator('[data-today-archive] [data-today-message="' + previous_report['id'] + '"]').get_by_text(displayed_report_comment(previous_report)['text'], exact=True).wait_for()
            gemini_sources = today.locator('[data-today-cards] [data-today-agent=gemini] .today-sources')
            gemini_sources.locator('summary').click()
            assert gemini_sources.get_by_text('실행 환경 Gemini 웹 · 앱 버전 미공개', exact=True).is_visible()
            assert '공식 Gemini 웹에서 받은 응답' in gemini_sources.inner_text()
            assert 'CLI null' not in gemini_sources.inner_text()
            gemini_sources.locator('summary').click()
            page.screenshot(path=str(output / 'today-distinct-picks-fixture-desktop.png'), full_page=True)
            # The same reviewed comments appear by symbol without becoming shared DB messages.
            page.goto(origin + '/#talk/NVDA')
            page.reload()
            published_comments = page.locator('#v-talk [data-role=published-reports]')
            published_comments.locator('[data-published-report-id]').first.wait_for()
            assert published_comments.locator('[data-published-report-id]').count() == 4
            assert published_comments.locator('[data-comment-id]').count() == 0
            nvda_reports = [report for report in today_fixture['value']['reports'] + today_fixture['value']['reportHistory'] if report['symbol'] == 'NVDA']
            for report in nvda_reports:
                comment = published_comments.locator('[data-published-report-id="' + report['id'] + '"]')
                fresh_comment = displayed_report_comment(report)
                comment.get_by_text(fresh_comment['text'], exact=True).wait_for()
                assert comment.get_attribute('data-ai-comment-id') == fresh_comment['id']
                assert comment.locator('time').first.get_attribute('datetime') == fresh_comment['provenance']['generatedAt']
                assert comment.locator('time').nth(1).get_attribute('datetime') == fresh_comment['createdAt']
                assert not any(label in comment.inner_text() for label in ['원문 발췌', '펨코 느낌', '디시 느낌', '블라인드 느낌'])
                assert comment.get_by_role('button').count() == 0
            assert published_comments.locator('[data-published-report-history]').count() == 3
            page.locator('#v-talk [data-tab=human]').click()
            assert published_comments.is_hidden()
            page.locator('#v-talk [data-tab=ai]').click()
            assert published_comments.is_visible()
            page.goto(origin + '/#talk/AMD')
            page.locator('#v-talk h2').wait_for()
            amd_comment = page.locator('#v-talk [data-published-report-id="report-gemini-distinct-browser"]')
            amd_comment.wait_for()
            assert page.locator('#v-talk [data-published-report-id]').count() == 1
            assert amd_comment.get_by_text(displayed_report_comment(today_fixture['value']['reports'][-1])['text'], exact=True).is_visible()
            assert page.locator('#v-talk [data-published-report-history]').count() == 0
            page.goto(origin + '/#talk/NVDA')
            page.locator('#v-talk [data-published-report-id]').first.wait_for()
            assert page.locator('#v-talk [data-published-report-id]').count() == 4
            page.locator('#v-talk [data-tab=mixed]').click()
            # Read the genuine reviewed publication without changing original report dates or content.
            # Market price below is an isolated browser fixture equal to Claude's recorded input quote.
            actual_today = json.loads((root / 'data/today-picks.json').read_text(encoding='utf-8'))
            actual_reports = {report['agent']: report for report in actual_today['reports']}
            assert {agent: report['symbol'] for agent, report in actual_reports.items()} == {'gpt': 'NVDA', 'claude': 'VRT', 'gemini': 'AVGO'}
            actual_claude = actual_reports['claude']
            actual_claude_json = structured_report(actual_claude)
            assert actual_claude_json['observedQuote']['price'] == 249.525
            assert actual_claude['fairValue']['price'] == 270
            today_fixture['value'] = actual_today
            vrt_quote = next(quote for quote in market_fixture['value']['quotes'] if quote['symbol'] == 'VRT')
            original_vrt_quote = json.loads(json.dumps(vrt_quote))
            vrt_quote.update(price=actual_claude_json['observedQuote']['price'], currency='USD', status='ok',
                             marketTime=int(datetime.now(timezone.utc).timestamp()) - 60, delayed=True, source='Yahoo Finance', error=None)
            page.goto(origin + '/#today')
            page.evaluate("value => window.dispatchEvent(new CustomEvent('market-snapshot', {detail:value}))", market_fixture['value'])
            refresh_today(page)
            today.locator('[data-today-agent=claude] [data-today-comment]').get_by_text(actual_today_comment(actual_claude), exact=True).wait_for()
            assert today.locator('[data-today-cards] [data-today-comment]').count() == 3
            assert today.locator('[data-today-cards] [data-today-response]').count() == 0
            current_kst_date = (datetime.now(timezone.utc) + timedelta(hours=9)).date().isoformat()
            actual_current_count = 0
            for agent, report in actual_reports.items():
                card = today.locator('[data-today-agent="' + agent + '"]')
                assert card.locator('.today-company .today-ticker').inner_text() == report['symbol']
                assert card.locator('[data-today-comment]').inner_text() == actual_today_comment(report)
                assert card.locator('[data-today-comment]').is_visible()
                report_date = (datetime.fromisoformat(report['createdAt'].replace('Z', '+00:00')) + timedelta(hours=9)).date().isoformat()
                if report_date == current_kst_date:
                    actual_current_count += 1
                    assert card.get_attribute('data-state') == 'published'
                    assert card.locator('[data-today-previous-report]').count() == 0
                else:
                    assert card.get_attribute('data-state') == 'previous-edition'
                    assert card.locator('[data-today-previous-report]').count() == 0
            actual_claude_card = today.locator('[data-today-agent=claude]')
            assert actual_claude_card.locator('[data-today-price]').inner_text() == '249.53 USD'
            assert actual_claude_card.locator('[data-today-fair-value]').inner_text() == '270 USD'
            assert actual_claude_card.locator('[data-today-estimate-gap]').inner_text() == '+8.21%'
            actual_claude_card.locator('[data-today-persona-analysis] > summary').click()
            assert actual_claude_card.locator('[data-today-persona-headline]').is_visible()
            assert actual_claude_card.locator('.today-report-original').count() == 0
            actual_claude_sources = actual_claude_card.locator('.today-sources')
            actual_claude_sources.locator('summary').click()
            assert actual_claude_sources.get_by_text('실행 환경 Claude 웹 · 앱 버전 미공개', exact=True).is_visible()
            assert actual_claude_sources.get_by_text('화면 선택 모델 ' + actual_claude['provenance']['requestedModel'], exact=True).is_visible()
            assert actual_claude_sources.get_by_text('실제 모델명 미확인', exact=True).is_visible()
            assert '공식 Claude 웹에서 받은 응답' in actual_claude_sources.inner_text()
            assert '웹 응답 확인 ' in actual_claude_sources.inner_text()
            assert 'CLI null' not in actual_claude_sources.inner_text()
            actual_claude_sources.locator('summary').click()
            page.screenshot(path=str(output / 'today-actual-three-reports-desktop.png'), full_page=True)
            page.goto(origin + '/#talk/VRT')
            page.reload()
            actual_claude_comment = page.locator('#v-talk [data-published-report-id="' + actual_claude['id'] + '"]')
            actual_claude_comment.get_by_text(actual_claude['comment'], exact=True).wait_for()
            assert actual_claude_comment.locator('strong').inner_text() == 'Claude · AI'
            assert actual_claude_comment.locator('time').first.inner_text().startswith('웹 응답 확인 ')
            assert actual_claude_comment.locator('time').first.get_attribute('datetime') == actual_claude['provenance']['generatedAt']
            assert actual_claude_comment.locator('time').nth(1).get_attribute('datetime') == actual_claude['createdAt']
            expected_vrt_reports = [report for report in actual_today['reports'] + actual_today['reportHistory'] if report['symbol'] == 'VRT']
            assert page.locator('#v-talk [data-published-report-id]').count() == len(expected_vrt_reports)
            page.locator('#v-talk [data-tab=human]').click()
            assert actual_claude_comment.is_hidden()
            page.locator('#v-talk [data-tab=ai]').click()
            assert actual_claude_comment.is_visible()
            assert page.locator('#v-talk [data-published-report-id][data-report-agent=claude]').count() == 1
            page.screenshot(path=str(output / 'claude-actual-stock-comment-desktop.png'), full_page=True)
            vrt_quote.clear(); vrt_quote.update(original_vrt_quote)
            page.unroute('**/data/today-picks.json', serve_today_fixture)
            page.goto(origin + '/#talk/NVDA')
            board = page.locator('#v-talk .community')
            board.get_by_text('브라우저 검증용 원문입니다.', exact=True).wait_for()
            latest_gpt = endpoints['fixture']['latestOpinions']['gpt']
            previous_gpt = endpoints['fixture']['previousOpinions']['gpt']
            opinion_cards = board.locator('[data-opinion-agent]')
            assert opinion_cards.count() == 3
            gpt_card = board.locator('[data-opinion-agent=gpt]')
            gpt_card.get_by_text(latest_gpt['text'], exact=True).wait_for()
            assert gpt_card.get_attribute('data-opinion-id') == latest_gpt['id']
            assert gpt_card.locator(':scope > time').get_attribute('datetime') == latest_gpt['createdAt']
            gpt_card.get_by_text('실제 모델 미확인', exact=True).first.wait_for()
            gpt_card.locator(':scope > .community-provenance > summary').click()
            latest_provenance = gpt_card.locator(':scope > .community-provenance')
            source_link = latest_provenance.get_by_role('link', name='근거 원문 ↗', exact=True).first
            assert source_link.get_attribute('href') == 'https://example.com/browser-fixture'
            assert source_link.get_attribute('target') == '_blank'
            assert 'noopener' in source_link.get_attribute('rel') and 'noreferrer' in source_link.get_attribute('rel')
            latest_provenance.get_by_text('공시 제목만 확인한 자료입니다. 본문이나 재무 수치를 읽은 자료가 아닙니다.', exact=True).wait_for()
            latest_provenance.get_by_text('이전 자료입니다. 현재 시점의 값으로 해석하지 마세요.', exact=True).wait_for()
            assert board.locator('[data-role=list] [data-comment-id="' + latest_gpt['id'] + '"]').count() == 1
            board.locator('[data-opinion-agent=claude]').get_by_text('생성 차단', exact=True).wait_for()
            board.locator('[data-opinion-agent=gemini]').get_by_text('현재 참여 중지', exact=True).wait_for()
            gpt_card.locator('[data-opinion-history] > summary').click()
            old_opinion = gpt_card.locator('[data-opinion-history-id="' + previous_gpt['id'] + '"]')
            old_opinion.get_by_text(previous_gpt['text'], exact=True).wait_for()
            old_opinion.get_by_role('link', name='대화 보기', exact=True).click()
            assert board.locator('[data-role=list] [data-comment-id="' + previous_gpt['id'] + '"]').count() == 1
            board.get_by_label('아이디', exact=True).fill('browser_member')
            board.get_by_label('비밀번호', exact=True).fill('fixture-only-password-123')
            board.get_by_role('button', name='로그인', exact=True).click()
            board.get_by_text('browser_member 님으로 작성합니다.', exact=True).wait_for()
            board.get_by_role('tab', name='인간', exact=True).click()
            assert board.locator('[data-role=opinions]').is_hidden()
            assert board.locator('[data-role=allow]').is_disabled()
            assert not board.locator('[data-role=allow]').is_checked()
            board.get_by_label('댓글 내용').fill('다른 브라우저에서도 보이는 검증 댓글')
            board.get_by_role('button', name='등록', exact=True).click()
            board.get_by_text('다른 브라우저에서도 보이는 검증 댓글', exact=True).wait_for()
            board.get_by_role('tab', name='AI', exact=True).click()
            assert board.get_by_text('브라우저 검증용 원문입니다.', exact=True).count() == 0
            board.get_by_text('화면 검증용 AI 댓글입니다.', exact=True).wait_for()
            assert board.get_by_text('다른 유형 또는 이전 댓글의 답글 · 전체 대화 보기', exact=True).count() > 0
            board.get_by_text('화면 검증용 AI 댓글입니다.', exact=True).locator('..').get_by_role('button', name='답글', exact=True).click()
            assert board.get_by_role('tab', name='AI + 인간', exact=True).get_attribute('aria-selected') == 'true'
            board.locator('[data-role=parent]').click()
            board.get_by_label('댓글 내용').fill('<img src=x onerror="window.__xss=1">')
            board.get_by_role('button', name='등록', exact=True).click()
            board.get_by_text('<img src=x onerror="window.__xss=1">', exact=True).wait_for()
            assert page.evaluate('window.__xss === undefined')
            assert not page.evaluate('Object.keys(localStorage).some(k => /token|password|session/i.test(k))')
            # A new draft typed while a saved POST resolves must not be cleared by that POST.
            page.evaluate("""() => {
              window.__originalCommunityFetch = window.fetch;
              window.fetch = async (...args) => {
                const response = await window.__originalCommunityFetch(...args);
                if (String(args[0]).endsWith('/api/community/comments') && args[1]?.method === 'POST' && response.ok) {
                  const input = document.querySelector('#v-talk [data-role=text]');
                  input.value = '전송 중에 새로 작성한 다음 초안';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                }
                return response;
              };
            }""")
            board.get_by_label('댓글 내용').fill('등록 응답과 새 초안을 구분하는 검증 댓글')
            board.get_by_role('button', name='등록', exact=True).click()
            board.get_by_text('등록 응답과 새 초안을 구분하는 검증 댓글', exact=True).wait_for()
            assert board.get_by_label('댓글 내용').input_value() == '전송 중에 새로 작성한 다음 초안'
            page.evaluate('window.fetch = window.__originalCommunityFetch; delete window.__originalCommunityFetch')
            page.goto(origin + '/#talk/NVDA/' + latest_gpt['id'])
            board.get_by_text(latest_gpt['text'], exact=True).first.wait_for()
            board.get_by_role('tab', name='인간', exact=True).click()
            board.get_by_role('button', name='새로고침', exact=True).click()
            page.wait_for_timeout(350)
            assert board.get_by_role('tab', name='인간', exact=True).get_attribute('aria-selected') == 'true'
            assert not board.locator('[data-role=allow]').is_checked()
            board.get_by_role('tab', name='AI + 인간', exact=True).click()
            board.locator('[data-role=allow]').uncheck()
            board.get_by_role('tab', name='AI', exact=True).click()
            board.get_by_role('tab', name='AI + 인간', exact=True).click()
            assert not board.locator('[data-role=allow]').is_checked()
            page.screenshot(path=str(output / 'discussion-desktop.png'), full_page=True)
            # The chart module replaces its DOM on quote refresh; the composer must survive.
            page.goto(origin + '/#data')
            page.locator('#market-results [data-market-symbol="NVDA"]').click()
            detail = page.locator('#market-community .community')
            detail.get_by_text('다른 브라우저에서도 보이는 검증 댓글', exact=True).wait_for()
            detail.get_by_label('댓글 내용').fill('시세 갱신에도 보존할 미작성 초안')
            page.evaluate("window.dispatchEvent(new CustomEvent('market-refresh-request'))")
            page.wait_for_timeout(1200)
            assert detail.get_by_label('댓글 내용').input_value() == '시세 갱신에도 보존할 미작성 초안'
            page.locator('#market-results [data-market-symbol="005930.KS"]').click()
            page.wait_for_timeout(300)
            assert detail.get_by_label('댓글 내용').input_value() == ''
            page.locator('#market-results [data-market-symbol="NVDA"]').click()
            assert detail.get_by_label('댓글 내용').input_value() == '시세 갱신에도 보존할 미작성 초안'
            page.locator('#market-community').scroll_into_view_if_needed()
            page.screenshot(path=str(output / 'stock-detail-desktop.png'))
            # Independent browser context reads the same durable shared API, no login needed.
            phone = browser.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=1)
            enable_fixture_community_runtime(phone, endpoints['apiOrigin'])
            mobile = phone.new_page(); mobile.on('pageerror', lambda error: errors.append(str(error)))
            captured_pages.append(mobile)
            mobile.route('**/api/chart?*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"fixture"}'))
            mobile.route('**/api/snapshot?*', serve_market_fixture)
            mobile.route('**/data/market.json?*', serve_market_fixture)
            mobile.route('**/data/market-display.json', serve_market_fixture)
            mobile.route('**/data/today-picks.json', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(empty_today_fixture())))
            mobile.goto(origin + '/#today')
            mobile.locator('#v-today').get_by_text('추천 미발행', exact=True).first.wait_for()
            assert mobile.locator('#v-today [data-today-agent]').count() == 3
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-mobile.png'), full_page=True)
            # Company picking and a long-period chart fit a narrow screen without clipping the page.
            mobile_comparison_fixture = {'status': 200, 'value': comparison_fixture['value']}
            def serve_mobile_comparison(route):
                route.fulfill(status=mobile_comparison_fixture['status'], content_type='application/json',
                              body=json.dumps(mobile_comparison_fixture['value'], ensure_ascii=False))
            mobile.route('**/api/comparison-history?*', serve_mobile_comparison)
            mobile.route('**/data/comparison-history.json?*', serve_mobile_comparison)
            mobile.route('**/data/comparison-history.json', serve_mobile_comparison)
            mobile.evaluate("location.hash = 'compare'")
            mobile_comparison = mobile.locator('#v-compare')
            mobile_comparison.locator('#peer-chart [data-peer-series="000660.KS"]').wait_for()
            assert mobile_comparison.locator('[data-peer-mode=companies]').get_attribute('aria-pressed') == 'true'
            assert mobile_comparison.locator('[data-peer-period="90"]').get_attribute('aria-pressed') == 'true'
            assert set(mobile_comparison.locator('[data-peer-series]').evaluate_all('els => els.map(el => el.dataset.peerSeries)')) == {'005930.KS', '000660.KS'}
            mobile_picker = mobile_comparison.locator('[data-peer-company-picker]')
            assert mobile_picker.get_attribute('open') is not None
            assert mobile_picker.locator('[data-peer-jump]:visible').count() == 8
            assert mobile_picker.locator('[data-peer-jump][aria-expanded="true"]').count() == 0
            assert mobile_comparison.locator('[data-peer-picker-panel]').is_hidden()
            assert mobile_picker.locator('.peer-card:visible').count() == 0
            assert mobile_comparison.locator('.peer-selection').is_hidden()
            assert mobile_comparison.locator('[data-peer-series="005930.KS"]').get_attribute('stroke') != mobile_comparison.locator('[data-peer-series="000660.KS"]').get_attribute('stroke')
            # The new common index strip intentionally occupies the initial fold.
            # A normal page scroll must reveal the whole plot above the fixed menu.
            mobile_chart = mobile_comparison.locator('#peer-chart')
            mobile_chart.scroll_into_view_if_needed()
            plot_box = mobile_chart.bounding_box()
            menu_box = mobile.locator('.tabbar').bounding_box()
            bottom_limit = menu_box['y'] if menu_box else mobile.viewport_size['height']
            # Browser auto-scroll does not account for the fixed bottom menu.
            # One normal vertical scroll must make the full chart reachable.
            covered = plot_box['y'] + plot_box['height'] - bottom_limit
            if covered > 0:
                mobile.mouse.move(120, 400)
                mobile.mouse.wheel(0, covered + 16)
                mobile.wait_for_function("""() => {
                  const chart = document.getElementById('peer-chart').getBoundingClientRect();
                  const menu = document.querySelector('.tabbar');
                  return chart.bottom <= (menu ? menu.getBoundingClientRect().top : innerHeight) + 1;
                }""")
                plot_box = mobile_chart.bounding_box()
            assert plot_box['y'] >= -1 and plot_box['y'] + plot_box['height'] <= bottom_limit + 1, {
                'plot': plot_box, 'bottomLimit': bottom_limit,
                'viewport': mobile.viewport_size,
            }
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'comparison-default-companies-mobile.png'))
            mobile_comparison.locator('[data-peer-period="1095"]').click()
            mobile_comparison.locator('#peer-chart [data-peer-series="000660.KS"]').wait_for()
            assert mobile_comparison.locator('[data-peer-period="1095"]').get_attribute('aria-pressed') == 'true'
            mobile_comparison_fixture['status'] = 503
            mobile_comparison.locator('[data-peer-refresh]').click()
            assert mobile_comparison.locator('#peer-chart [data-peer-series="000660.KS"]').count()==1
            show_company_chain(mobile_comparison, 1)
            assert mobile_picker.locator('.peer-card:visible').count() == 1
            assert mobile_picker.locator('[data-peer-chain="1"]').is_visible()
            mobile_comparison.locator('[data-peer-clear-companies]').click()
            mobile_comparison.locator('[data-peer-symbol="ASML"]').first.check()
            show_company_chain(mobile_comparison, 4)
            assert mobile_picker.locator('[data-peer-chain="1"]').is_hidden()
            assert mobile_picker.locator('[data-peer-chain="4"]').is_visible()
            mobile_comparison.locator('[data-peer-symbol="NVDA"]').first.check()
            assert mobile_comparison.locator('[data-peer-remove-symbol]').count() == 2
            assert mobile_comparison.locator('[data-peer-series]').count() == 2
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            assert mobile_comparison.locator('[data-peer-company-picker] .peer-card').count() == 8
            assert mobile_comparison.locator('.peer-card').count() == 8
            assert 0 < mobile_comparison.locator('[data-peer-picker-list]').evaluate('el => el.clientHeight') <= 260
            assert mobile_comparison.evaluate("el => el.querySelector('[data-peer-company-picker]').getBoundingClientRect().bottom <= el.querySelector('#peer-chart').getBoundingClientRect().top")
            mobile.screenshot(path=str(output / 'comparison-companies-mobile.png'), full_page=True)
            mobile.evaluate("location.hash = 'today'")
            mobile.locator('#v-today').get_by_text('추천 미발행', exact=True).first.wait_for()
            mobile_today_fixture = today_browser_fixture()
            mobile.route('**/data/today-picks.json', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(mobile_today_fixture, ensure_ascii=False)))
            refresh_today(mobile)
            mobile.get_by_text(mobile_today_fixture['picks'][2]['comment'], exact=True).wait_for()
            assert mobile.locator('#v-today [data-today-comment]').count() == 3
            assert mobile.locator('#v-today [data-today-response-comment]').count() == 3
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-populated-fixture-mobile.png'), full_page=True)
            mobile_today_fixture = reviewed_reports_browser_fixture()
            refresh_today(mobile)
            mobile.locator('#v-today [data-today-agent=gemini] .today-ticker').wait_for()
            assert mobile.locator('#v-today [data-today-cards] [data-today-comment]').count() == 3
            for report in mobile_today_fixture['reports']:
                mobile_card = mobile.locator('#v-today [data-today-agent="' + report['agent'] + '"]')
                if report['agent'] == 'claude':
                    mobile_card.get_by_role('heading', name='추천 미발행', exact=True).wait_for()
                    assert mobile_card.locator('[data-today-comment]').is_hidden()
                    mobile_card.locator('[data-today-factual-review] > summary').click()
                assert mobile_card.locator('[data-today-comment]').inner_text() == displayed_report_comment(report)['text']
                assert not any(label in mobile_card.inner_text() for label in ['원문 발췌', '펨코 느낌', '디시 느낌', '블라인드 느낌'])
            assert mobile.locator('#v-today [data-today-agent=gpt] .today-company .today-ticker').inner_text() == 'NVDA'
            assert mobile.locator('#v-today [data-today-agent=gemini] .today-company .today-ticker').inner_text() == 'AMD'
            assert mobile.locator('#v-today [data-today-agent=gemini] .today-report-original').count() == 0
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-reviewed-reports-fixture-mobile.png'), full_page=True)
            mobile_today_fixture = recommendation_only_browser_fixture()
            refresh_today(mobile)
            mobile.locator('#v-today [data-today-agent=gpt]').get_by_text(mobile_today_fixture['reports'][0]['comment'], exact=True).wait_for()
            assert mobile.locator('#v-today [data-today-cards] [data-today-comment]').count() == 2
            mobile.locator('#v-today [data-today-agent=claude]').get_by_role('heading', name='추천 미발행', exact=True).wait_for()
            assert mobile.locator('#v-today [data-today-agent=claude] .today-company').count() == 0
            if mobile.locator('#v-today [data-today-archive]').get_attribute('open') is None:
                mobile.locator('#v-today [data-today-archive] > summary').click()
            assert mobile.locator('#v-today [data-today-archive] [data-today-comment]').count() == 4
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-distinct-picks-fixture-mobile.png'), full_page=True)
            mobile_today_fixture = actual_today
            refresh_today(mobile)
            mobile.locator('#v-today [data-today-agent=claude] [data-today-comment]').get_by_text(actual_today_comment(actual_claude), exact=True).wait_for()
            assert mobile.locator('#v-today [data-today-cards] [data-today-comment]').count() == 3
            for agent, report in actual_reports.items():
                mobile_card = mobile.locator('#v-today [data-today-agent="' + agent + '"]')
                assert mobile_card.locator('.today-company .today-ticker').inner_text() == report['symbol']
                assert mobile_card.locator('[data-today-comment]').is_visible()
            mobile_claude = mobile.locator('#v-today [data-today-agent=claude]')
            mobile_claude.locator('.today-sources > summary').click()
            assert mobile_claude.get_by_text('실행 환경 Claude 웹 · 앱 버전 미공개', exact=True).is_visible()
            assert mobile_claude.locator('[data-today-fair-value]').inner_text() == '270 USD'
            mobile_claude.locator('.today-sources > summary').click()
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-actual-three-reports-mobile.png'), full_page=True)
            mobile.goto(origin + '/#talk/NVDA')
            mobile.get_by_text('다른 브라우저에서도 보이는 검증 댓글', exact=True).wait_for()
            mobile.locator('[data-opinion-agent=gpt]').get_by_text(latest_gpt['text'], exact=True).wait_for()
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'discussion-mobile.png'), full_page=True)
            # Operator controls are available only after an operator login.
            mobile.get_by_label('아이디', exact=True).fill('browser_operator')
            mobile.get_by_label('비밀번호', exact=True).fill('fixture-only-password-456')
            mobile.get_by_role('button', name='로그인', exact=True).click()
            mobile.get_by_role('button', name='관리 현황 조회', exact=True).click()
            mobile.locator('[data-role=admin] > summary').click()
            mobile.get_by_role('button', name='이 종목 AI 끄기', exact=True).wait_for()
            assert mobile.get_by_role('button', name='자동 게시로 변경', exact=True).count() == 0
            mobile.get_by_role('button', name='이 종목 AI 끄기', exact=True).click()
            mobile.get_by_role('button', name='이 종목 AI 켜기', exact=True).wait_for()
            mobile.get_by_role('button', name='이 종목 AI 켜기', exact=True).click()
            mobile.get_by_role('button', name='이 종목 AI 끄기', exact=True).wait_for()
            mobile.get_by_label('모델별 하루 생성 한도', exact=True).fill('151')
            mobile.get_by_role('button', name='일일 한도 저장', exact=True).click()
            mobile.wait_for_function("() => { const input = document.querySelector('[data-admin-limits] input[aria-label=\"모델별 하루 생성 한도\"]'); return input?.value === '151' && !input.disabled }")
            mobile.get_by_role('region', name='운영 측정값', exact=True).get_by_text('운영 측정값', exact=True).wait_for()
            assert '미수집' in mobile.get_by_role('region', name='운영 측정값', exact=True).inner_text()
            mobile.get_by_label('Claude 의견 생성', exact=True).uncheck()
            assert mobile.get_by_label('Gemini 의견 생성', exact=True).is_disabled()
            opinion_requests = []
            def track_opinion_request(request):
                if '/api/community/admin/opinions' in request.url and request.method == 'POST':
                    opinion_requests.append(request.post_data_json)
            mobile.on('request', track_opinion_request)
            def lose_opinion_response(route):
                route.fetch()
                route.abort('failed')
            mobile.route('**/api/community/admin/opinions', lose_opinion_response)
            mobile.get_by_role('button', name='의견 생성 작업 등록', exact=True).click()
            mobile.wait_for_function("() => { const button = document.querySelector('[data-admin-opinions] button[type=submit]'); return !!button && !button.disabled }")
            mobile.unroute('**/api/community/admin/opinions', lose_opinion_response)
            mobile.get_by_role('button', name='의견 생성 작업 등록', exact=True).click()
            mobile.wait_for_function("() => { const button = document.querySelector('[data-admin-opinions] button[type=submit]'); return !!button && !button.disabled }")
            assert len(opinion_requests) == 2
            assert opinion_requests[0]['requestId'] == opinion_requests[1]['requestId']
            assert opinion_requests[1]['symbols'] == ['NVDA'] and opinion_requests[1]['agents'] == ['gpt']
            mobile.get_by_label('의견 생성 대상', exact=True).select_option('all')
            mobile.get_by_role('button', name='의견 생성 작업 등록', exact=True).click()
            mobile.wait_for_function("() => { const button = document.querySelector('[data-admin-opinions] button[type=submit]'); return !!button && !button.disabled }")
            mobile.locator('.community-admin-report').wait_for()
            assert len(opinion_requests) == 3 and opinion_requests[2]['all'] is True
            mobile_gpt = mobile.locator('[data-opinion-agent=gpt]')
            mobile_gpt.get_by_role('button', name='이 의견 숨김', exact=True).click()
            mobile.locator('[data-opinion-id="' + latest_gpt['id'] + '"]').wait_for(state='detached')
            assert mobile.get_by_text(latest_gpt['text'], exact=True).count() == 0
            mobile.locator('[data-opinion-agent=gpt][data-opinion-id="' + previous_gpt['id'] + '"]').wait_for()
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'opinion-admin-mobile.png'))
            phone.close(); context.close(); browser.close()
        assert not errors, errors
        (output / 'result.json').write_text(json.dumps({'passed': True, 'pageErrors': errors, 'checks': ['Default paused runtime reads stored AI publications without API calls, EventSource or polling', 'Five global indices precede the chapter header and persist across chapter navigation', 'Live community integration opts in only through in-memory fixture runtime routes', 'Today empty and three independent populated cards', 'Today per-parent replies preserve independent provenance and reject invalid parents, plus unknown actual model provenance', 'Default market home and explicit Today navigation; removed Today controls stay absent', 'Today previous edition and failed reload hide current picks; explicit saved-archive updates and failure events preserve quote provenance', 'Today populated mobile width', 'HTTPS and cross-origin API', 'member login', 'shared comments across browser contexts', 'latest opinions use shared message IDs', 'opinion history and provenance', 'actual failed and disabled states', 'hidden parent placeholder', 'AI/human filters', 'AI reply switches to mixed', 'XSS displayed as text', 'no credential persistence', 'new draft survives pending POST', 'deep link does not reset human tab', 'AI permission choice survives tab changes', 'per-symbol detail composer', 'draft survives quote refresh', 'mobile width', 'comparison 3-year lazy loading and failures', 'selected company curves and dates', 'Samsung and SK Hynix default curves, collapsed company picker, intentional removals and empty selection preserved, bounded desktop/mobile height and preserved scroll/focus', 'admin scope and per-symbol pause', 'daily limits and real usage metrics', 'opinion request retry idempotency', 'selected and all-symbol requests', 'hidden latest opinion removed from cards and history']}, ensure_ascii=False, indent=2))
        print('Browser smoke passed (fixture AI only). Screenshots:', output)
    finally:
        fixture.terminate()
        try:
            fixture.wait(timeout=10)
        except subprocess.TimeoutExpired:
            fixture.kill(); fixture.wait()
