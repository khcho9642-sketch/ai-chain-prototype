import { createMemberAuthClient, memberAuthMessage, MemberAuthError } from './member-auth-core.js'

const client = createMemberAuthClient()
const triggers = [...document.querySelectorAll('[data-member-auth-open]')]
const element = (tag, text, className) => {
  const item = document.createElement(tag)
  if (text !== undefined) item.textContent = text
  if (className) item.className = className
  return item
}
let user = null, configuration = null, initialization = null, scriptPromise = null
let activeAttempt = 0, initializationEpoch = 0, returnFocus = null, submitting = false
const dialog = element('dialog', undefined, 'member-auth-dialog')
dialog.id = 'member-auth-dialog'
dialog.setAttribute('aria-labelledby', 'member-auth-title')
const shell = element('div', undefined, 'member-auth-shell')
const close = element('button', '×', 'member-auth-close')
close.type = 'button'; close.setAttribute('aria-label', '로그인 창 닫기')
const eyebrow = element('p', 'AI VALUE CHAIN', 'member-auth-eyebrow')
const heading = element('h2', '로그인')
heading.id = 'member-auth-title'
const description = element('p', '', 'member-auth-description')
const content = element('div')
const status = element('p', '', 'member-auth-status')
status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true')
shell.append(close, eyebrow, heading, description, content, status)
dialog.append(shell)
if (triggers.length) document.body.append(dialog)

function say(message = '', tone = '') { status.textContent = message; status.dataset.tone = tone }
function busy(value) { content.setAttribute('aria-busy', String(value)) }
function updateTriggers() {
  for (const trigger of triggers) {
    trigger.textContent = user ? '내 계정' : '로그인'
    trigger.dataset.signedIn = String(!!user)
    trigger.setAttribute('aria-label', user ? `${user.name} 님, 내 계정 열기` : '로그인 창 열기')
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
function showAccount(message = '') {
  heading.textContent = '내 계정'
  description.textContent = 'Google 계정으로 로그인되어 있습니다.'
  content.replaceChildren(); busy(false)
  const profile = element('div', undefined, 'member-auth-profile')
  const avatar = element('span', Array.from(user.name)[0] || '회', 'member-auth-avatar')
  avatar.setAttribute('aria-hidden', 'true')
  const identity = element('div', undefined, 'member-auth-identity')
  identity.append(element('p', user.name, 'member-auth-name'), element('p', user.email, 'member-auth-email'))
  profile.append(avatar, identity); content.append(profile)
  const logout = action('로그아웃', async () => {
    if (submitting) return
    submitting = true; logout.disabled = true; busy(true); say('로그아웃하고 있습니다.')
    try {
      await client.logout()
      try { window.google?.accounts?.id?.disableAutoSelect() } catch { /* Session was already revoked by the server. */ }
      user = null; updateTriggers(); signedOut()
      say('로그아웃되었습니다.', 'success')
      action('다시 로그인', prepareGoogle)
    } catch (error) { say(memberAuthMessage(error), 'error'); logout.disabled = false }
    finally { submitting = false; busy(false) }
  })
  say(message, message ? 'success' : '')
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
    content.append(element('p', '처음 로그인하면 회원 계정이 만들어집니다.', 'member-auth-note'))
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
if (triggers.length) initialize().catch(() => { /* Explain failures only when the member opens the dialog. */ })
