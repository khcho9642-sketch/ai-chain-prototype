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
            board.get_by_label('아이디', exact=True).fill('browser_member')
            board.get_by_label('비밀번호', exact=True).fill('fixture-only-password-123')
            board.get_by_role('button', name='로그인', exact=True).click()
            board.get_by_text('browser_member 님으로 작성합니다.', exact=True).wait_for()
            board.get_by_role('tab', name='인간', exact=True).click()
            assert board.locator('[data-role=allow]').is_disabled()
            assert not board.locator('[data-role=allow]').is_checked()
            board.get_by_label('댓글 내용').fill('다른 브라우저에서도 보이는 검증 댓글')
            board.get_by_role('button', name='등록', exact=True).click()
            board.get_by_text('다른 브라우저에서도 보이는 검증 댓글', exact=True).wait_for()
            board.get_by_role('tab', name='AI', exact=True).click()
            assert board.get_by_text('브라우저 검증용 원문입니다.', exact=True).count() == 0
            board.get_by_text('화면 검증용 AI 댓글입니다.', exact=True).wait_for()
            board.get_by_role('button', name='답글', exact=True).click()
            assert board.get_by_role('tab', name='AI + 인간', exact=True).get_attribute('aria-selected') == 'true'
            board.locator('[data-role=parent]').click()
            board.get_by_label('댓글 내용').fill('<img src=x onerror="window.__xss=1">')
            board.get_by_role('button', name='등록', exact=True).click()
            board.get_by_text('<img src=x onerror="window.__xss=1">', exact=True).wait_for()
            assert page.evaluate('window.__xss === undefined')
            assert not page.evaluate('Object.keys(localStorage).some(k => /token|password|session/i.test(k))')
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
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            mobile.screenshot(path=str(output / 'discussion-mobile.png'), full_page=True)
            # Operator controls are available only after an operator login.
            mobile.get_by_label('아이디', exact=True).fill('browser_operator')
            mobile.get_by_label('비밀번호', exact=True).fill('fixture-only-password-456')
            mobile.get_by_role('button', name='로그인', exact=True).click()
            mobile.get_by_role('button', name='관리 현황 조회', exact=True).click()
            mobile.locator('[data-role=admin] summary').click()
            mobile.get_by_role('button', name='이 종목 AI 끄기', exact=True).wait_for()
            assert mobile.get_by_role('button', name='자동 게시로 변경', exact=True).count() == 0
            mobile.get_by_role('button', name='이 종목 AI 끄기', exact=True).click()
            mobile.get_by_role('button', name='이 종목 AI 켜기', exact=True).wait_for()
            phone.close(); context.close(); browser.close()
        assert not errors, errors
        (output / 'result.json').write_text(json.dumps({'passed': True, 'pageErrors': errors, 'checks': ['HTTPS and cross-origin API', 'member login', 'shared comments across browser contexts', 'AI/human filters', 'AI reply switches to mixed', 'XSS displayed as text', 'no credential persistence', 'per-symbol detail composer', 'draft survives quote refresh', 'mobile width', 'admin scope and per-symbol pause']}, ensure_ascii=False, indent=2))
        print('Browser smoke passed (fixture AI only). Screenshots:', output)
    finally:
        fixture.terminate()
        try:
            fixture.wait(timeout=10)
        except subprocess.TimeoutExpired:
            fixture.kill(); fixture.wait()
