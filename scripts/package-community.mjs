import { lstat, readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const COMMUNITY_RELEASE_FILES = Object.freeze([
  'assets/instruments.js',
  'scripts/community-server.mjs',
  'scripts/community-account.mjs',
  'scripts/community-backup.mjs',
  'server/community/public-http.mjs',
  'server/community/store.mjs',
  'server/community/auth.mjs',
  'server/community/policy.mjs',
  'deploy/community-api.service.example',
  'deploy/Caddyfile.community.example',
  'docs/ai-community-public.md',
])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (base, target) => {
  const rel = relative(base, target)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}
const packageRoot = fileURLToPath(new URL('../', import.meta.url))

async function sourceFile(root, sourceRoot, name) {
  const target = resolve(root, name)
  if (!inside(root, target)) throw new Error('Release source escapes the project root.')
  let cursor = root
  for (const part of relative(root, target).split(sep)) {
    cursor = join(cursor, part)
    const info = await lstat(cursor)
    if (info.isSymbolicLink()) throw new Error('Release sources must not contain symlinks or junctions.')
    if (cursor === target ? !info.isFile() : !info.isDirectory()) throw new Error('Invalid release source type.')
  }
  if (!inside(sourceRoot, await realpath(target))) throw new Error('Release source resolves outside the project root.')
  return readFile(target)
}

async function releaseParent(root) {
  let cursor = root
  for (const part of ['.local', 'releases']) {
    cursor = join(cursor, part)
    try {
      const info = await lstat(cursor)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Release output parent must be a normal directory.')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await mkdir(cursor, { mode: 0o700 })
    }
  }
  if (!inside(await realpath(root), await realpath(cursor))) throw new Error('Release output resolves outside the project root.')
  return cursor
}

export const COMMUNITY_ENV_TEMPLATE = `# TEMPLATE ONLY: create the real protected file on the service host.
# This public placeholder is deliberately too short to start the service.
COMMUNITY_WORKER_TOKEN=REPLACE_ME
COMMUNITY_DB=/var/lib/ai-chain/community.sqlite
COMMUNITY_PUBLIC_ORIGIN=https://community-api.example.com
COMMUNITY_BROWSER_ORIGINS=https://ai-chain-prototype.vercel.app
COMMUNITY_HOST=127.0.0.1
COMMUNITY_PORT=5180
COMMUNITY_TRUST_LOOPBACK_PROXY=1
COMMUNITY_OPEN_REGISTRATION=0
COMMUNITY_ALLOW_AUTO_PUBLISH=0
`

const RELEASE_README = `# AI Chain shared community API release

This is source prepared for one persistent Linux host with Node.js 24 and its built-in SQLite. No npm dependencies, web frontend, database contents, AI credentials or local worker are included.

1. Check manifest.json and the source revision before transfer. Keep the source release directory separate from the writable database and backup directories.
2. Install the source at the reviewed server path (the service example uses /srv/ai-chain). Use one API process with one persistent local SQLite volume.
3. Create the dedicated ai-chain OS user and protected persistent directory /var/lib/ai-chain. Prepare /etc/ai-chain/community.env from deploy/community.env.example ON THE SERVER. Generate the worker token on the server; do not use REPLACE_ME or publish real values.
4. Set the actual API HTTPS origin and exact browser origins. Review the Caddy/systemd examples before installing them; this release does not change DNS, firewall, OS users or running services.
5. Run the offline account command as the dedicated ai-chain OS user, so SQLite files are writable by the API service. Supply operator account JSON over stdin to node --env-file=/etc/ai-chain/community.env scripts/community-account.mjs create-admin. Do not put passwords on the command line.
6. Start the API only after reviewing the paths and HTTPS reverse proxy. The example binds Node to loopback. Keep registration invite-only and AI publishing in review mode initially.
7. Point the existing frontend's COMMUNITY_API_ORIGIN build setting to the verified API URL. Configure the independent local AI worker separately. Actual model login, isolation and output quality remain separate activation work.

The full existing operational guide is docs/ai-community-public.md. No Oracle resources or account are created by packaging this release. There is no promise that a cloud instance is free or available.

To back up a live service, use the included community-backup.mjs online backup command with a different absolute destination. Do not copy only a live SQLite database file and omit its WAL. Store backups privately outside the service host.
`

/** Copy only the explicit public runtime closure. This never installs or starts a service. */
export async function packageCommunity({ root = packageRoot, output, revision } = {}) {
  root = resolve(root)
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/i.test(revision)) throw new Error('A full 40-character source commit is required.')
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Project root must be a normal directory.')
  const sourceRoot = await realpath(root)
  const releaseBase = join(root, '.local', 'releases')
  const destination = output ? resolve(root, output) : join(releaseBase, 'community-api-' + revision.slice(0, 12))
  if (dirname(destination) !== releaseBase || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(relative(releaseBase, destination))) {
    throw new Error('Release output must be a named directory directly inside .local/releases.')
  }
  // Validate/read every allowlisted source before reserving a new output folder.
  const files = new Map()
  for (const name of COMMUNITY_RELEASE_FILES) files.set(name, await sourceFile(root, sourceRoot, name))
  files.set('package.json', Buffer.from(JSON.stringify({ name: 'ai-chain-community-api', private: true, type: 'module', engines: { node: '24.x' }, scripts: { start: 'node scripts/community-server.mjs', account: 'node scripts/community-account.mjs', backup: 'node scripts/community-backup.mjs' } }, null, 2) + '\n'))
  files.set('deploy/community.env.example', Buffer.from(COMMUNITY_ENV_TEMPLATE))
  files.set('README.md', Buffer.from(RELEASE_README))
  await releaseParent(root)
  // Non-recursive reservation refuses existing folders, files and symlinks.
  await mkdir(destination, { mode: 0o700 })
  const manifest = { schemaVersion: 1, sourceCommit: revision.toLowerCase(), createdAt: new Date().toISOString(), files: [] }
  for (const [name, bytes] of files) {
    const target = join(destination, name)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, bytes, { flag: 'wx', mode: 0o644 })
    manifest.files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) })
  }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o644 })
  return { destination, manifest }
}

async function main() {
  const args = process.argv.slice(2), options = { root: packageRoot }
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output', '--revision'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/package-community.mjs [--revision FULL_COMMIT] [--output .local/releases/NAME]')
    const key = args[i] === '--output' ? 'output' : 'revision'
    if (options[key]) throw new Error('Duplicate release argument.')
    options[key] = args[i + 1]
  }
  options.revision ||= execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' }).trim()
  if (!/^[a-f0-9]{40}$/i.test(options.revision)) throw new Error('Invalid source commit.')
  // Record a commit only when every packaged source matches that exact commit.
  const tracked = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', options.revision, '--', ...COMMUNITY_RELEASE_FILES], { cwd: packageRoot, encoding: 'utf8' }).trim().split(/\r?\n/))
  if (!COMMUNITY_RELEASE_FILES.every(name => tracked.has(name))) throw new Error('Release source is missing from the selected commit.')
  execFileSync('git', ['diff', '--quiet', options.revision, '--', ...COMMUNITY_RELEASE_FILES], { cwd: packageRoot, stdio: 'pipe' })
  const result = await packageCommunity(options)
  console.log(`Community API source release prepared: ${result.destination}`)
  console.log(`Source commit: ${result.manifest.sourceCommit}; files: ${result.manifest.files.length}; no server was installed or started.`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Community release failed. Confirm source commit, clean runtime sources, normal paths and a new output directory.'); process.exitCode = 1 })
