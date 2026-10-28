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
    value.update(schemaVersion=3, reports=reports, picks=value['picks'][:1], responses=[],
                 publishedAt=value['publishedAt'].replace('Z', '.200Z'))
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
                assert card.locator('.today-price-fields dt').all_inner_texts() == ['현재 시가', '시가 기준일', 'AI 추정 적정가격']
                assert card.locator('[data-today-fair-value]').inner_text() == ('150 USD' if pick['agent'] == 'gpt' else '미산정')
                assert card.locator('.today-initial-comment > .today-message-label').inner_text() == '의견'
            assert today.locator('[data-today-comment]').count() == 3
            assert today.locator('[data-today-response]').count() == 3
            # Shared market updates change the displayed price, not the AI's historical source or opinion.
            market_quote['price'] = 124.56
            page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
            today.locator('[data-today-agent=gpt]').get_by_text('124.56 USD', exact=True).wait_for()
            market_fixture['status'] = 503
            page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
            today.locator('[data-today-agent=gpt]').get_by_text('이전 확인값 · 조회 실패 · 지연 시세 · Yahoo Finance', exact=True).wait_for()
            assert today.locator('[data-today-agent=gpt] [data-today-price]').inner_text() == '124.56 USD'
            market_fixture['status'] = 200
            page.evaluate("window.dispatchEvent(new Event('market-refresh-request'))")
            page.wait_for_function("!document.querySelector('[data-today-agent=gpt] [data-today-field=price]').textContent.includes('조회 실패')")
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
            today_fixture['status'] = 503
            today.locator('[data-today-refresh]').click()
            today.get_by_text('발행 자료를 불러오지 못했습니다. 다시 읽기로 확인해주세요.', exact=True).wait_for()
            assert today.locator('[data-today-comment]').count() == 0
            assert today.locator('[data-today-response]').count() == 0
            assert today.locator('[data-today-archive]').is_hidden()
            # One-off reports share existing cards and retain earlier publications.
            today_fixture.update(status=200, value=reviewed_reports_browser_fixture())
            today.locator('[data-today-refresh]').click()
            today.get_by_text('AI 댓글 3개 발행', exact=False).wait_for()
            assert today.locator('[data-today-cards] [data-today-comment]').count() == 3
            assert today.locator('[data-today-cards] [data-today-response]').count() == 0
            for report in today_fixture['value']['reports']:
                card = today.locator('[data-today-agent="' + report['agent'] + '"]')
                fresh_comment = report['conversationComment']
                assert card.locator('[data-today-comment]').inner_text() == fresh_comment['text']
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
                    'gpt': '216.48 USD', 'claude': '가격 평가 없음', 'gemini': '222 USD'}[report['agent']]
                if report['agent'] == 'claude':
                    assert card.locator('.today-pick-kicker').inner_text() == '검토 대상 · 실적 검토'
                    assert '고른 종목' not in card.inner_text()
                card.locator('.today-initial-comment > .today-sources > summary').click()
                cli_label = {'gpt': 'Codex', 'claude': 'Claude Code', 'gemini': 'Antigravity'}[report['agent']]
                card.get_by_text('CLI ' + cli_label + ' cli-1.0.0', exact=True).wait_for()
                card.get_by_text('댓글 작성 출처', exact=True).wait_for()
                card.get_by_text('CLI ' + fresh_comment['provenance']['cliName'] + ' · cli-1.0.0', exact=True).wait_for()
                card.get_by_text('댓글 SHA-256 ' + fresh_comment['provenance']['responseSha256'], exact=True).wait_for()
            assert today.locator('[data-today-archive]').is_visible()
            if today.locator('[data-today-archive]').get_attribute('open') is None:
                today.locator('[data-today-archive] > summary').click()
            assert today.locator('[data-today-archive] [data-today-comment]').count() == 1
            assert today.locator('[data-today-archive-agent=gpt] [data-today-comment]').inner_text() == today_fixture['value']['picks'][0]['comment']
            page.screenshot(path=str(output / 'today-reviewed-reports-fixture-desktop.png'), full_page=True)
            # The same reviewed comments appear by symbol without becoming shared DB messages.
            page.goto(origin + '/#talk/NVDA')
            page.reload()
            published_comments = page.locator('#v-talk [data-role=published-reports]')
            published_comments.locator('[data-published-report-id]').first.wait_for()
            assert published_comments.locator('[data-published-report-id]').count() == 3
            assert published_comments.locator('[data-comment-id]').count() == 0
            for report in today_fixture['value']['reports']:
                comment = published_comments.locator('[data-report-agent="' + report['agent'] + '"]')
                fresh_comment = report['conversationComment']
                comment.get_by_text(fresh_comment['text'], exact=True).wait_for()
                assert comment.get_attribute('data-ai-comment-id') == fresh_comment['id']
                assert comment.locator('time').first.get_attribute('datetime') == fresh_comment['provenance']['generatedAt']
                assert comment.locator('time').nth(1).get_attribute('datetime') == fresh_comment['createdAt']
                assert not any(label in comment.inner_text() for label in ['원문 발췌', '펨코 느낌', '디시 느낌', '블라인드 느낌'])
                assert comment.get_by_role('button').count() == 0
            page.locator('#v-talk [data-tab=human]').click()
            assert published_comments.is_hidden()
            page.locator('#v-talk [data-tab=ai]').click()
            assert published_comments.is_visible()
            page.goto(origin + '/#talk/AMD')
            page.locator('#v-talk h2').wait_for()
            assert page.locator('#v-talk [data-published-report-id]').count() == 0
            page.goto(origin + '/#talk/NVDA')
            page.locator('#v-talk [data-published-report-id]').first.wait_for()
            assert page.locator('#v-talk [data-published-report-id]').count() == 3
            page.locator('#v-talk [data-tab=mixed]').click()
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
            mobile.locator('#v-today').get_by_text('AI 댓글 3개 발행', exact=False).wait_for()
            assert mobile.locator('#v-today [data-today-cards] [data-today-comment]').count() == 3
            for report in mobile_today_fixture['reports']:
                mobile_card = mobile.locator('#v-today [data-today-agent="' + report['agent'] + '"]')
                assert mobile_card.locator('[data-today-comment]').inner_text() == report['conversationComment']['text']
                assert not any(label in mobile_card.inner_text() for label in ['원문 발췌', '펨코 느낌', '디시 느낌', '블라인드 느낌'])
            mobile.locator('#v-today [data-today-agent=gemini] .today-report-original > summary').click()
            assert mobile.locator('#v-today [data-today-agent=gemini] [data-today-report-original]').is_visible()
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'today-reviewed-reports-fixture-mobile.png'), full_page=True)
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
        (output / 'result.json').write_text(json.dumps({'passed': True, 'pageErrors': errors, 'checks': ['Today empty and three independent populated cards', 'Today per-parent replies preserve independent provenance and reject invalid parents, plus unknown actual model provenance', 'Today stock chart and discussion navigation', 'Today previous edition and failed refresh hide current picks', 'Today populated mobile width', 'HTTPS and cross-origin API', 'member login', 'shared comments across browser contexts', 'latest opinions use shared message IDs', 'opinion history and provenance', 'actual failed and disabled states', 'hidden parent placeholder', 'AI/human filters', 'AI reply switches to mixed', 'XSS displayed as text', 'no credential persistence', 'new draft survives pending POST', 'deep link does not reset human tab', 'AI permission choice survives tab changes', 'per-symbol detail composer', 'draft survives quote refresh', 'mobile width', 'admin scope and per-symbol pause', 'daily limits and real usage metrics', 'opinion request retry idempotency', 'selected and all-symbol requests', 'hidden latest opinion removed from cards and history']}, ensure_ascii=False, indent=2))
        print('Browser smoke passed (fixture AI only). Screenshots:', output)
    finally:
        fixture.terminate()
        try:
            fixture.wait(timeout=10)
        except subprocess.TimeoutExpired:
            fixture.kill(); fixture.wait()
