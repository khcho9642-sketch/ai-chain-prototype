import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { CommunityStore } from '../server/community/store.mjs'
import { CommunityAuth } from '../server/community/auth.mjs'
import { instruments } from '../assets/instruments.js'

// Offline operator command. Credentials come from stdin, never argv or logs.
const action = process.argv[2], path = process.env.COMMUNITY_DB
if (!['create-admin', 'reset-password', 'invite'].includes(action) || !path || !isAbsolute(path)) {
  throw new Error('Set absolute COMMUNITY_DB; use create-admin, reset-password or invite. Supply JSON on stdin.')
}
mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
const store = new CommunityStore({ path, catalog: instruments.filter(x => x.chains.some(n => n > 0)) })
const auth = new CommunityAuth(store)
try {
  if (action === 'invite') console.log(JSON.stringify(auth.invite()))
  else {
    let input = ''
    for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 4096) throw new Error('Input too large') }
    const data = JSON.parse(input)
    if (action === 'create-admin') await auth.create(data, { role: 'admin', bootstrap: true })
    else await auth.reset(data.name, data.password)
    console.log('Account operation completed. No credentials printed.')
  }
} catch (error) { console.error(error.code || 'Account operation failed'); process.exitCode = 1 }
finally { store.close() }
