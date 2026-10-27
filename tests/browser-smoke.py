"""Optional isolated HTTPS/CORS browser smoke test. Uses fixture responses, not real AI.
Requires Python playwright, a local Chromium/Chrome and openssl. No service deployment.
Run: python tests/browser-smoke.py --browser /usr/bin/chromium
"""
import argparse
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--browser', default=None)
parser.add_argument('--output', default='.local/browser-smoke')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = (root / args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
errors = []
with tempfile.TemporaryDirectory(prefix='ai-chain-browser-') as temp:
    key, cert = Path(temp) / 'key.pem', Path(temp) / 'cert.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key), '-out', str(cert), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env = dict(os.environ, COMMUNITY_BROWSER_FIXTURE='1', SMOKE_TLS_KEY=str(key), SMOKE_TLS_CERT=str(cert))
    fixture = subprocess.Popen(['node', 'tests/helpers/browser-server.mjs'], cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        endpoints = json.loads(fixture.stdout.readline())
        origin = endpoints['siteOrigin']
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.browser or shutil.which('google-chrome') or shutil.which('chromium') or p.chromium.executable_path, headless=True, args=['--no-sandbox'])
            context = browser.new_context(ignore_https_errors=True, viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/api/chart?*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"browser fixture: external quote lookup disabled"}'))
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
            board.locator('[data-opinion-agent=claude]').get_by_text('생성 실패', exact=True).wait_for()
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
            mobile.route('**/api/chart?*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"fixture"}'))
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
            mobile.wait_for_function("document.querySelector('[data-admin-limits] input[aria-label=\"모델별 하루 생성 한도\"]').value === '151' && !document.querySelector('[data-admin-limits] input').disabled")
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
            mobile.wait_for_function("!document.querySelector('[data-admin-opinions] button[type=submit]').disabled")
            mobile.unroute('**/api/community/admin/opinions', lose_opinion_response)
            mobile.get_by_role('button', name='의견 생성 작업 등록', exact=True).click()
            mobile.wait_for_function("!document.querySelector('[data-admin-opinions] button[type=submit]').disabled")
            assert len(opinion_requests) == 2
            assert opinion_requests[0]['requestId'] == opinion_requests[1]['requestId']
            assert opinion_requests[1]['symbols'] == ['NVDA'] and opinion_requests[1]['agents'] == ['gpt']
            mobile.get_by_label('의견 생성 대상', exact=True).select_option('all')
            mobile.get_by_role('button', name='의견 생성 작업 등록', exact=True).click()
            mobile.wait_for_function("!document.querySelector('[data-admin-opinions] button[type=submit]').disabled")
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
        (output / 'result.json').write_text(json.dumps({'passed': True, 'pageErrors': errors, 'checks': ['HTTPS and cross-origin API', 'member login', 'shared comments across browser contexts', 'latest opinions use shared message IDs', 'opinion history and provenance', 'actual failed and disabled states', 'hidden parent placeholder', 'AI/human filters', 'AI reply switches to mixed', 'XSS displayed as text', 'no credential persistence', 'new draft survives pending POST', 'deep link does not reset human tab', 'AI permission choice survives tab changes', 'per-symbol detail composer', 'draft survives quote refresh', 'mobile width', 'admin scope and per-symbol pause', 'daily limits and real usage metrics', 'opinion request retry idempotency', 'selected and all-symbol requests', 'hidden latest opinion removed from cards and history']}, ensure_ascii=False, indent=2))
        print('Browser smoke passed (fixture AI only). Screenshots:', output)
    finally:
        fixture.terminate()
        try:
            fixture.wait(timeout=10)
        except subprocess.TimeoutExpired:
            fixture.kill(); fixture.wait()
