import { createMemberAuthClient, memberAuthMessage, MemberAuthError, normalizeMemberNickname } from './member-auth-core.js'

const client = createMemberAuthClient()
const triggers = [...document.querySelectorAll('[data-member-auth-open]')]
const element = (tag, text, className) => {
  const item = document.createElement(tag)
  if (text !== undefined) item.textContent = text
  if (className) item.className = className
  return item
}
let user = null, configuration = null, initialization = null, scriptPromise = null
let activeAttempt = 0, initializationEpoch = 0, returnFocus = null, submitting = false, nicknameDraft = ''
const dialog = element('dialog', undefined, 'member-auth-dialog')
dialog.id = 'member-auth-dialog'
dialog.setAttribute('aria-labelledby', 'member-auth-title')
const shell = element('div', undefined, 'member-auth-shell')
const close = element('button', '×', 'member-auth-close')
close.type = 'button'; close.setAttribute('aria-label', '계정 창 닫기')
const eyebrow = element('p', 'AI VALUE CHAIN', 'member-auth-eyebrow')
const heading = element('h2', '로그인')
heading.id = 'member-auth-title'; heading.tabIndex = -1
const description = element('p', '', 'member-auth-description')
const content = element('div')
const status = element('p', '', 'member-auth-status')
status.id = 'member-auth-status'
status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true')
const privacy = element('p', undefined, 'member-auth-privacy')
const privacyLink = element('a', '로그인 정보 처리 안내 (새 탭)')
privacyLink.href = './privacy.html'; privacyLink.target = '_blank'; privacyLink.rel = 'noopener'
privacy.append(privacyLink)
shell.append(close, eyebrow, heading, description, content, status, privacy)
dialog.append(shell)
if (triggers.length) document.body.append(dialog)

function say(message = '', tone = '') { status.textContent = message; status.dataset.tone = tone }
function busy(value) { content.setAttribute('aria-busy', String(value)) }
function updateTriggers() {
  for (const trigger of triggers) {
    const label = user ? (user.needsNickname ? '닉네임 설정' : user.nickname) : '로그인'
    trigger.replaceChildren(element('span', label, 'member-auth-trigger-label'))
    trigger.dataset.signedIn = String(!!user)
    trigger.setAttribute('aria-label', user ? (user.needsNickname ? '닉네임 설정 열기' : `${user.nickname} 님, 내 계정 열기`) : '로그인 창 열기')
    trigger.setAttribute('aria-controls', dialog.id)
  }
}
function action(label, handler) {
  const button = element('button', label, 'member-auth-action')
  button.type = 'button'; button.addEventListener('click', handler)
  content.append(button)
  return button
}
function signedOut() {
  heading.textContent = '로그인'
  description.textContent = '구글 계정으로 간편하게 시작하세요.'
  content.replaceChildren(); say(); busy(false)
}
function addLogout() {
  const logout = action('로그아웃', async () => {
    if (submitting) return
    submitting = true; logout.disabled = true; busy(true); say('로그아웃하고 있습니다.')
    try {
      await client.logout()
      try { window.google?.accounts?.id?.disableAutoSelect() } catch { /* Session was already revoked by the server. */ }
      user = null; nicknameDraft = ''; updateTriggers(); signedOut()
      say('로그아웃되었습니다.', 'success')
      action('다시 로그인', prepareGoogle)
    } catch (error) { say(memberAuthMessage(error), 'error'); logout.disabled = false }
    finally { submitting = false; busy(false) }
  })
}
function showAccount(message = '') {
  if (user.needsNickname) { showNickname(); return }
  heading.textContent = '내 계정'
  description.textContent = '사이트에서 사용하는 닉네임입니다.'
  content.replaceChildren(); busy(false)
  const profile = element('div', undefined, 'member-auth-profile')
  const avatar = element('span', Array.from(user.nickname)[0], 'member-auth-avatar')
  avatar.setAttribute('aria-hidden', 'true')
  const identity = element('div', undefined, 'member-auth-identity')
  identity.append(element('p', user.nickname, 'member-auth-name'))
  profile.append(avatar, identity); content.append(profile)
  addLogout()
  say(message, message ? 'success' : '')
  if (message) heading.focus()
}
function showNickname() {
  heading.textContent = '닉네임 설정'
  description.textContent = '사이트에서 사용할 닉네임만 입력해 주세요.'
  content.replaceChildren(); busy(false); say()
  const form = element('form', undefined, 'member-auth-nickname-form')
  form.noValidate = true
  const label = element('label', '닉네임', 'member-auth-label')
  label.htmlFor = 'member-auth-nickname'
  const input = element('input', undefined, 'member-auth-input')
  input.id = 'member-auth-nickname'; input.name = 'nickname'; input.type = 'text'; input.autocomplete = 'nickname'
  input.autocapitalize = 'none'; input.spellcheck = false; input.required = true; input.maxLength = 40
  input.enterKeyHint = 'done'; input.value = nicknameDraft; input.placeholder = '닉네임을 입력하세요'
  input.setAttribute('aria-describedby', 'member-auth-nickname-hint member-auth-status')
  const hint = element('p', '2~20자 · 한글·영문 등 문자, 숫자, 밑줄(_) · 공백 제외', 'member-auth-hint')
  hint.id = 'member-auth-nickname-hint'
  const submit = element('button', '완료', 'member-auth-action member-auth-primary')
  submit.type = 'submit'
  const recovery = element('div')
  let composing = false
  input.addEventListener('compositionstart', () => { composing = true })
  input.addEventListener('compositionend', () => { composing = false; nicknameDraft = input.value })
  input.addEventListener('input', () => { nicknameDraft = input.value; input.removeAttribute('aria-invalid') })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (submitting || composing) return
    nicknameDraft = input.value
    let nickname
    try { nickname = normalizeMemberNickname(nicknameDraft) }
    catch (error) { input.setAttribute('aria-invalid', 'true'); say(memberAuthMessage(error), 'error'); input.focus(); return }
    submitting = true; submit.disabled = true; input.readOnly = true; busy(true); recovery.replaceChildren(); say('닉네임을 저장하고 있습니다.')
    try {
      const member = await client.profile(nickname)
      if (member.needsNickname) throw new MemberAuthError('invalid_response')
      user = member; nicknameDraft = ''; updateTriggers()
      if (dialog.open) showAccount('닉네임이 설정되었습니다.')
    } catch (error) {
      say(error?.code === 'invalid_nickname' || error?.code === 'nickname_already_set' || error?.status === 429 || error?.status === 401
        ? memberAuthMessage(error) : '닉네임을 저장하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.', 'error')
      if (error?.code === 'invalid_nickname') input.setAttribute('aria-invalid', 'true')
      if (error?.status === 401 || error?.code === 'nickname_already_set') {
        const retry = element('button', error.status === 401 ? '다시 로그인' : '계정 다시 확인', 'member-auth-action')
        retry.type = 'button'
        retry.addEventListener('click', async () => {
          if (submitting) return
          if (error.status === 401) { user = null; updateTriggers(); await prepareGoogle(); return }
          retry.disabled = true
          try { await initialize(true); if (user) showAccount(); else await prepareGoogle() }
          catch (failure) { say(memberAuthMessage(failure), 'error'); retry.disabled = false }
        })
        recovery.append(retry)
      }
      input.focus()
    } finally { submitting = false; submit.disabled = false; input.readOnly = false; busy(false) }
  })
  form.append(label, input, hint, submit, recovery)
  content.append(form)
  addLogout()
  input.focus()
}

async function initialize(refresh = false) {
  if (!refresh && initialization) return initialization
  const epoch = ++initializationEpoch
  initialization = (async () => {
    const config = await client.config()
    const member = config.enabled ? await client.me() : null
    if (epoch === initializationEpoch) { configuration = config; user = member; updateTriggers() }
    return config
  })()
  return initialization
}

function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client?hl=ko'; script.async = true
    const timeout = setTimeout(() => finish(false), 15000)
    const finish = success => {
      clearTimeout(timeout); script.onload = null; script.onerror = null
      if (success && window.google?.accounts?.id) resolve(window.google.accounts.id)
      else { script.remove(); scriptPromise = null; reject(new MemberAuthError('google_script_failed')) }
    }
    script.onload = () => finish(true); script.onerror = () => finish(false)
    document.head.append(script)
  })
  return scriptPromise
}

async function prepareGoogle() {
  if (submitting || !dialog.open) return
  const attempt = ++activeAttempt
  signedOut(); busy(true); say('로그인 화면을 준비하고 있습니다.')
  try {
    // A retry also rechecks server configuration, allowing setup to finish while
    // this page stays open. No recurring checks or background prompts are used.
    await initialize(true)
    if (attempt !== activeAttempt || !dialog.open) return
    if (user) { showAccount(); return }
    if (!configuration.enabled) throw new MemberAuthError('not_configured')
    const google = await loadGoogle()
    if (attempt !== activeAttempt || !dialog.open) return
    const nonce = await client.nonce()
    if (attempt !== activeAttempt || !dialog.open) return
    const target = element('div', undefined, 'member-auth-google')
    content.replaceChildren(target)
    google.initialize({
      client_id: configuration.clientId, nonce, auto_select: false, use_fedcm_for_button: true, button_auto_select: false,
      callback: async response => {
        if (attempt !== activeAttempt || !dialog.open || submitting) return
        submitting = true; busy(true); target.hidden = true; say('로그인을 확인하고 있습니다.')
        try {
          user = await client.google(response?.credential)
          updateTriggers()
          if (dialog.open) showAccount('로그인되었습니다.')
        } catch (error) {
          if (dialog.open) { content.replaceChildren(); say(memberAuthMessage(error), 'error'); action('다시 시도', prepareGoogle) }
        } finally { submitting = false; busy(false) }
      },
    })
    const width = Math.max(200, Math.min(360, Math.floor(content.getBoundingClientRect().width)))
    google.renderButton(target, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width, locale: 'ko' })
    content.append(element('p', '처음 로그인한 뒤 닉네임을 설정하면 가입이 완료됩니다.', 'member-auth-note'))
    say(); busy(false)
  } catch (error) {
    if (attempt !== activeAttempt || !dialog.open) return
    busy(false); say(memberAuthMessage(error), 'error'); action('다시 확인', prepareGoogle)
  }
}

async function openAccount(trigger) {
  if (dialog.open) return
  returnFocus = trigger
  dialog.showModal(); close.focus()
  if (user) showAccount()
  else await prepareGoogle()
}
close.addEventListener('click', () => dialog.close())
dialog.addEventListener('click', event => { if (event.target === dialog && !submitting) dialog.close() })
dialog.addEventListener('close', () => { ++activeAttempt; window.google?.accounts?.id?.cancel(); returnFocus?.focus() })
// showModal supplies the native tab trap, inert background and Escape handling.
for (const trigger of triggers) trigger.addEventListener('click', () => openAccount(trigger))
updateTriggers()
if (triggers.length) initialize().then(() => {
  // Restore an unfinished signup once after a reload; closing never completes it.
  if (user?.needsNickname && !dialog.open) openAccount(triggers[0])
}).catch(() => { /* Explain failures only when the member opens the dialog. */ })
