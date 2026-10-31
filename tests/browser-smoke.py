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
            context = browser.new_context(ignore_https_errors=True, viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            captured_pages.append(page)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/api/chart?*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"browser fixture: external quote lookup disabled"}'))
            market_fixture = {'status': 200, 'value': json.loads((root / 'data/market.json').read_text(encoding='utf-8'))}
            market_quote = next(quote for quote in market_fixture['value']['quotes'] if quote['symbol'] == 'NVDA')
            market_quote.update(price=123.45, currency='USD', marketTime=int(datetime.now(timezone.utc).timestamp()) - 60,
                                delayed=True, status='ok', source='Yahoo Finance', error=None)
            page.route('**/api/snapshot?*', lambda route: route.fulfill(status=market_fixture['status'], content_type='application/json', body=json.dumps(market_fixture['value'])))
            page.route('**/data/today-picks.json', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(empty_today_fixture())))
            home_requests = []
            page.on('request', lambda request: home_requests.append((request.method, request.url)))
            page.goto(origin + '/')
            today = page.locator('#v-today')
            today.get_by_role('heading', name='AI Value Chain Today', exact=True).wait_for()
            today.get_by_text('추천 미발행', exact=True).first.wait_for()
            assert today.locator('[data-today-agent]').count() == 3
            assert today.locator('[data-today-comment]').count() == 0
            assert today.locator('.today-agent-style').count() == 0
            assert not any(style in today.inner_text() for style in ['펨코 느낌', '디시 느낌', '블라인드 느낌'])
            assert page.locator('#v-map').is_hidden()
            today.locator('[data-today-refresh]').click()
            page.wait_for_function("!document.querySelector('[data-today-refresh]').disabled")
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
            page.evaluate("location.hash = 'compare'")
            comparison.get_by_role('heading', name='8개 고리 주가 흐름 비교', exact=True).wait_for()
            assert comparison.locator('.peer-card').count() == 8
            assert comparison.locator('[data-peer-mode=groups]').get_attribute('aria-pressed') == 'true'
            assert not comparison_history_requests
            comparison.locator('[data-peer-mode=companies]').click()
            assert comparison.locator('[data-peer-empty]').is_visible()
            assert comparison.locator('#peer-chart').count() == 0
            samsung = comparison.locator('[data-peer-symbol="005930.KS"]')
            assert samsung.count() == 2
            samsung.first.check()
            assert all(samsung.nth(i).is_checked() for i in range(samsung.count()))
            comparison.locator('[data-peer-symbol="NVDA"]').first.check()
            assert comparison.locator('[data-peer-remove-symbol]').count() == 2
            assert comparison.locator('[data-peer-series="005930.KS"]').count() == 1
            assert comparison.locator('[data-peer-series="NVDA"]').count() == 1
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
            # A refresh failure keeps the original history and explicitly identifies it as an earlier success.
            comparison_fixture['status'] = 503
            comparison.locator('[data-peer-refresh]').click()
            comparison.get_by_role('alert').filter(has_text='마지막 성공 수집값을 유지합니다.').wait_for()
            assert comparison.locator('[data-peer-series="NVDA"]').count() == 1
            assert comparison.locator('[data-peer-remove-symbol]').count() == 3
            comparison_fixture['status'] = 200
            comparison.locator('[data-peer-refresh]').click()
            page.wait_for_function("!document.querySelector('[data-peer-refresh]').disabled")
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
            today.get_by_role('heading', name='AI Value Chain Today', exact=True).wait_for()
            # Exercise populated cards through a browser-only response, never real AI or public file writes.
            today_fixture = {'value': today_browser_fixture(), 'status': 200}
            def serve_today_fixture(route):
                route.fulfill(status=today_fixture['status'], content_type='application/json', body=json.dumps(today_fixture['value'], ensure_ascii=False))
            page.route('**/data/today-picks.json', serve_today_fixture)
            today.locator('[data-today-refresh]').click()
            for pick in today_fixture['value']['picks']:
                card = today.locator('[data-today-agent="' + pick['agent'] + '"]')
                card.get_by_text(pick['comment'], exact=True).wait_for()
                assert card.locator('[data-today-comment]').count() == 1
                assert card.get_attribute('data-pick-id') == pick['id']
                assert card.locator('.today-initial-comment time').get_attribute('datetime') == pick['createdAt']
                card.get_by_text('123.45 USD', exact=True).wait_for()
                assert '지연 시세' in card.locator('[data-today-field=price]').inner_text()
                assert 'KST' in card.locator('[data-today-price-as-of]').inner_text()
                assert card.locator('.today-price-fields dt').all_inner_texts() == ['현재 시가', '시가 기준일', 'AI 추정 가격', '시가 대비 추정 차이']
                assert card.locator('[data-today-fair-value]').inner_text() == ('150 USD' if pick['agent'] == 'gpt' else '미산정')
                assert card.locator('[data-today-estimate-gap]').inner_text() == ('+21.51%' if pick['agent'] == 'gpt' else '—')
                assert card.locator('[data-today-field=estimate-gap]').get_attribute('data-estimate-state') == ('above' if pick['agent'] == 'gpt' else 'missing')
                assert ('추정 가격이 시가보다 높음' if pick['agent'] == 'gpt' else '가격 추정 보류') in card.locator('[data-today-field=estimate-gap]').inner_text()
                assert card.locator('.today-company .today-pick-kicker').inner_text() == ('고른 종목 · 상승 여력 조건 충족' if pick['agent'] == 'gpt' else '관심 종목 · 가격 추정 보류')
                assert card.locator('.today-initial-comment > .today-message-label').inner_text() == '의견'
            assert today.locator('[data-today-comment]').count() == 3
            assert today.locator('[data-today-response]').count() == 3
            # Shared market updates change the displayed price, not the AI's historical source or opinion.
            market_quote['price'] = 124.56
            page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
            today.locator('[data-today-agent=gpt]').get_by_text('124.56 USD', exact=True).wait_for()
            assert today.locator('[data-today-agent=gpt] [data-today-estimate-gap]').inner_text() == '+20.42%'
            market_fixture['status'] = 503
            page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
            today.locator('[data-today-agent=gpt]').get_by_text('이전 확인값 · 조회 실패 · 지연 시세 · Yahoo Finance', exact=True).wait_for()
            assert today.locator('[data-today-agent=gpt] [data-today-price]').inner_text() == '124.56 USD'
            assert today.locator('[data-today-agent=gpt] [data-today-estimate-gap]').inner_text() == '—'
            assert '비교 불가' in today.locator('[data-today-agent=gpt] [data-today-field=estimate-gap]').inner_text()
            market_fixture['status'] = 200
            page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
            page.wait_for_function("!document.querySelector('[data-today-agent=gpt] [data-today-field=price]').textContent.includes('조회 실패')")
            # Compare the unchanged estimate honestly, including nonzero differences that round to zero.
            for current_price, expected_gap, expected_state in [(151, '−0.66%', 'below'), (150, '0.00%', 'equal'),
                                                               (149.999, '+0.01% 미만', 'above'), (150.001, '−0.01% 미만', 'below')]:
                market_quote['price'] = current_price
                page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
                today.locator('[data-today-agent=gpt]').get_by_text(expected_gap, exact=True).wait_for()
                gap = today.locator('[data-today-agent=gpt] [data-today-field=estimate-gap]')
                assert gap.get_attribute('data-estimate-state') == expected_state
                assert ('추정 가격이 시가보다 높음' if expected_state == 'above' else '상승 여력 조건 미충족') in gap.inner_text()
                assert today.locator('[data-today-agent=gpt] .today-company .today-pick-kicker').inner_text() == ('고른 종목 · 상승 여력 조건 충족' if expected_state == 'above' else '참고 의견 · 상승 여력 조건 미충족')
                assert ('상승 여력 조건 충족 1개' if expected_state == 'above' else '상승 여력 조건 충족 0개') in today.locator('[data-today-status]').inner_text()
                assert today.locator('[data-today-agent=gpt] [data-today-fair-value]').inner_text() == '150 USD'
            market_quote.update(price=124.56, currency='KRW')
            page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
            today.locator('[data-today-agent=gpt]').get_by_text('124.56 KRW', exact=True).wait_for()
            assert '비교 불가' in today.locator('[data-today-agent=gpt] [data-today-field=estimate-gap]').inner_text()
            assert today.locator('[data-today-agent=gpt] [data-today-estimate-gap]').inner_text() == '—'
            market_quote['currency'] = 'USD'
            page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
            today.locator('[data-today-agent=gpt]').get_by_text('+20.42%', exact=True).wait_for()
            for response in today_fixture['value']['responses']:
                parent_card = today.locator('[data-pick-id="' + response['parentId'] + '"]')
                reply = parent_card.locator('[data-today-response="' + response['id'] + '"]')
                reply.get_by_text(response['comment'], exact=True).wait_for()
                assert reply.get_attribute('data-parent-id') == response['parentId']
                assert reply.locator('[data-today-response-comment]').count() == 1
                assert reply.locator('time').get_attribute('datetime') == response['createdAt']
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
            today_gpt.get_by_role('button', name='종목 · 차트', exact=False).click()
            page.wait_for_url(origin + '/#data')
            page.locator('#market-selected h3').wait_for()
            assert 'NVDA' in page.locator('#market-selected h3').inner_text()
            page.goto(origin + '/#today')
            today_gpt.get_by_role('link', name='생각 나누기 →', exact=True).click()
            page.wait_for_url(origin + '/#talk/NVDA')
            page.locator('#v-talk .community').get_by_text('브라우저 검증용 원문입니다.', exact=True).wait_for()
            page.goto(origin + '/#today')
            today_fixture['value'] = today_browser_fixture()
            today_fixture['value']['responses'][0]['parentId'] = 'not-a-published-parent'
            today.locator('[data-today-refresh]').click()
            today.get_by_text('발행 자료를 불러오지 못했습니다. 다시 읽기로 확인해주세요.', exact=True).wait_for()
            assert today.locator('[data-today-comment]').count() == 0
            assert today.locator('[data-today-response]').count() == 0
            today_fixture['value'] = today_browser_fixture(day_offset=-1)
            today.locator('[data-today-refresh]').click()
            today.locator('[data-today-agent=gpt]').get_by_text('오늘의 추천은 아직 없습니다.', exact=True).wait_for()
            assert today.locator('[data-today-cards] [data-today-comment]').count() == 0
            assert today.locator('[data-today-cards] [data-today-response]').count() == 0
            today.locator('[data-today-archive] > summary').click()
            assert today.locator('[data-today-archive-agent]').count() == 3
            assert today.locator('[data-today-archive] [data-today-comment]').count() == 3
            assert today.locator('[data-today-archive] [data-today-response]').count() == 3
            assert today.locator('[data-today-archive] [data-today-estimate-gap]').count() == 0
            today_fixture['status'] = 503
            today.locator('[data-today-refresh]').click()
            today.get_by_text('발행 자료를 불러오지 못했습니다. 다시 읽기로 확인해주세요.', exact=True).wait_for()
            assert today.locator('[data-today-comment]').count() == 0
            assert today.locator('[data-today-response]').count() == 0
            assert today.locator('[data-today-archive]').is_hidden()
            # One-off reports share existing cards and retain earlier publications.
            today_fixture.update(status=200, value=reviewed_reports_browser_fixture())
            today.locator('[data-today-refresh]').click()
            today.get_by_text('서로 다른 종목 의견 2개', exact=False).wait_for()
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
                assert card.locator('.today-review-notes').is_visible()
                card.get_by_text(report['reviewNotes'][0], exact=True).wait_for()
                assert card.locator('.today-message-label').first.inner_text() == {'gpt': 'GPT', 'claude': 'Claude', 'gemini': 'Gemini'}[report['agent']] + ' · AI'
                assert not any(label in card.inner_text() for label in ['원문 발췌', '펨코 느낌', '디시 느낌', '블라인드 느낌'])
                card.locator('.today-report-original > summary').click()
                assert card.locator('[data-today-report-original]').inner_text() == report['report']
                assert card.locator('.today-initial-comment time').first.get_attribute('datetime') == fresh_comment['provenance']['generatedAt']
                assert card.locator('.today-initial-comment time').nth(1).get_attribute('datetime') == fresh_comment['createdAt']
                assert card.locator('[data-today-fair-value]').inner_text() == {
                    'gpt': '216.48 USD', 'claude': '가격 평가 없음', 'gemini': '미산정'}[report['agent']]
                if report['agent'] == 'claude':
                    assert card.locator('.today-company .today-pick-kicker').inner_text() == '검토 대상 · 실적 검토'
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
            today.locator('[data-today-refresh]').click()
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
            today.locator('[data-today-refresh]').click()
            today.locator('[data-today-agent=claude] [data-today-comment]').get_by_text(actual_claude['comment'], exact=True).wait_for()
            assert today.locator('[data-today-cards] [data-today-comment]').count() == 3
            assert today.locator('[data-today-cards] [data-today-response]').count() == 0
            current_kst_date = (datetime.now(timezone.utc) + timedelta(hours=9)).date().isoformat()
            actual_current_count = 0
            for agent, report in actual_reports.items():
                card = today.locator('[data-today-agent="' + agent + '"]')
                assert card.locator('.today-company .today-ticker').inner_text() == report['symbol']
                assert card.locator('[data-today-comment]').inner_text() == displayed_report_comment(report)['text']
                assert card.locator('[data-today-comment]').is_visible()
                report_date = (datetime.fromisoformat(report['createdAt'].replace('Z', '+00:00')) + timedelta(hours=9)).date().isoformat()
                if report_date == current_kst_date:
                    actual_current_count += 1
                    assert card.get_attribute('data-state') == 'published'
                    assert card.locator('[data-today-previous-report]').count() == 0
                else:
                    assert card.get_attribute('data-state') == 'previous-edition'
                    assert card.locator('[data-today-previous-report]').inner_text() == '이전 발행 · ' + report_date
            assert f'오늘 발행 {actual_current_count}개' in today.locator('[data-today-status]').inner_text()
            actual_claude_card = today.locator('[data-today-agent=claude]')
            assert actual_claude_card.locator('[data-today-price]').inner_text() == '249.53 USD'
            assert actual_claude_card.locator('[data-today-fair-value]').inner_text() == '270 USD'
            assert actual_claude_card.locator('[data-today-estimate-gap]').inner_text() == '+8.21%'
            actual_claude_card.locator('.today-report-original > summary').click()
            assert actual_claude_card.locator('.today-report-original > .today-report-text').inner_text() == actual_claude_json['opinion']
            actual_claude_card.locator('.today-native-response > summary').click()
            assert actual_claude_card.locator('[data-today-report-original]').inner_text() == actual_claude['report']
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
            mobile = phone.new_page(); mobile.on('pageerror', lambda error: errors.append(str(error)))
            captured_pages.append(mobile)
            mobile.route('**/api/chart?*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"fixture"}'))
            mobile.route('**/data/today-picks.json', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(empty_today_fixture())))
            mobile.goto(origin + '/')
            mobile.locator('#v-today').get_by_text('추천 미발행', exact=True).first.wait_for()
            assert mobile.locator('#v-today [data-today-agent]').count() == 3
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-mobile.png'), full_page=True)
            # Company picking and a long-period chart fit a narrow screen without clipping the page.
            mobile_comparison_fixture = {'status': 503, 'value': comparison_fixture['value']}
            def serve_mobile_comparison(route):
                route.fulfill(status=mobile_comparison_fixture['status'], content_type='application/json',
                              body=json.dumps(mobile_comparison_fixture['value'], ensure_ascii=False))
            mobile.route('**/api/comparison-history?*', serve_mobile_comparison)
            mobile.route('**/data/comparison-history.json?*', serve_mobile_comparison)
            mobile.evaluate("location.hash = 'compare'")
            mobile_comparison = mobile.locator('#v-compare')
            mobile_comparison.locator('[data-peer-period="1095"]').click()
            mobile_comparison.get_by_role('alert').filter(has_text='2·3년 비교를 표시할 수 없습니다.').wait_for()
            assert mobile_comparison.locator('#peer-chart').count() == 0
            assert mobile_comparison.locator('[data-peer-period="1095"]').get_attribute('aria-pressed') == 'true'
            mobile_comparison_fixture['status'] = 200
            mobile_comparison.locator('[data-peer-refresh]').click()
            mobile.wait_for_function("!document.querySelector('[data-peer-refresh]').disabled")
            mobile_comparison.locator('[data-peer-symbol="ASML"]').first.check()
            mobile_comparison.locator('[data-peer-symbol="NVDA"]').first.check()
            assert mobile_comparison.locator('[data-peer-remove-symbol]').count() == 2
            assert mobile_comparison.locator('[data-peer-series]').count() == 2
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'comparison-companies-mobile.png'), full_page=True)
            mobile.evaluate("location.hash = 'today'")
            mobile.locator('#v-today').get_by_text('추천 미발행', exact=True).first.wait_for()
            mobile_today_fixture = today_browser_fixture()
            mobile.route('**/data/today-picks.json', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(mobile_today_fixture, ensure_ascii=False)))
            mobile.locator('#v-today [data-today-refresh]').click()
            mobile.get_by_text(mobile_today_fixture['picks'][2]['comment'], exact=True).wait_for()
            assert mobile.locator('#v-today [data-today-comment]').count() == 3
            assert mobile.locator('#v-today [data-today-response-comment]').count() == 3
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-populated-fixture-mobile.png'), full_page=True)
            mobile_today_fixture = reviewed_reports_browser_fixture()
            mobile.locator('#v-today [data-today-refresh]').click()
            mobile.locator('#v-today').get_by_text('서로 다른 종목 의견 2개', exact=False).wait_for()
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
            mobile.locator('#v-today [data-today-agent=gemini] .today-report-original > summary').click()
            assert mobile.locator('#v-today [data-today-agent=gemini] [data-today-report-original]').is_visible()
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-reviewed-reports-fixture-mobile.png'), full_page=True)
            mobile_today_fixture = recommendation_only_browser_fixture()
            mobile.locator('#v-today [data-today-refresh]').click()
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
            mobile.locator('#v-today [data-today-refresh]').click()
            mobile.locator('#v-today [data-today-agent=claude] [data-today-comment]').get_by_text(actual_claude['comment'], exact=True).wait_for()
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
        (output / 'result.json').write_text(json.dumps({'passed': True, 'pageErrors': errors, 'checks': ['Today empty and three independent populated cards', 'Today per-parent replies preserve independent provenance and reject invalid parents, plus unknown actual model provenance', 'Today stock chart and discussion navigation', 'Today previous edition and failed refresh hide current picks', 'Today populated mobile width', 'HTTPS and cross-origin API', 'member login', 'shared comments across browser contexts', 'latest opinions use shared message IDs', 'opinion history and provenance', 'actual failed and disabled states', 'hidden parent placeholder', 'AI/human filters', 'AI reply switches to mixed', 'XSS displayed as text', 'no credential persistence', 'new draft survives pending POST', 'deep link does not reset human tab', 'AI permission choice survives tab changes', 'per-symbol detail composer', 'draft survives quote refresh', 'mobile width', 'comparison 3-year lazy loading and failures', 'selected company curves and dates', 'admin scope and per-symbol pause', 'daily limits and real usage metrics', 'opinion request retry idempotency', 'selected and all-symbol requests', 'hidden latest opinion removed from cards and history']}, ensure_ascii=False, indent=2))
        print('Browser smoke passed (fixture AI only). Screenshots:', output)
    finally:
        fixture.terminate()
        try:
            fixture.wait(timeout=10)
        except subprocess.TimeoutExpired:
            fixture.kill(); fixture.wait()
