import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, copyFile, readdir, rm, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { packageCommunity, COMMUNITY_RELEASE_FILES } from '../../scripts/deployment/package-community.mjs'

const repository = process.env.COMMUNITY_PACKAGE_TEST_SOURCE ? resolve(process.env.COMMUNITY_PACKAGE_TEST_SOURCE) : fileURLToPath(new URL('../../', import.meta.url))
const revision = 'a'.repeat(40)
const isInside = (base, value) => { const part = relative(base, value); return part && !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep) }
async function fixture(t) {
  const outer = await mkdtemp(join(tmpdir(), 'ai-chain-package-')), root = join(outer, 'source')
  await mkdir(root)
  t.after(async () => {
    // Only this known, resolved per-test directory under the OS temp directory can be removed.
    const target = resolve(outer)
    assert.ok(isInside(resolve(tmpdir()), target))
    await rm(target, { recursive: true, force: true })
  })
  for (const file of COMMUNITY_RELEASE_FILES) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await copyFile(join(repository, file), join(root, file))
  }
  return { root, outer }
}
async function allFiles(root, prefix = '') {
  const names = []
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + item.name : item.name
    names.push(...(item.isDirectory() ? await allFiles(root, name) : [name]))
  }
  return names
}

test('release includes only the public runtime closure, safe templates and verified per-file hashes', async t => {
  const { root } = await fixture(t)
  await writeFile(join(root, '.env'), 'TEST_SECRET_MUST_NOT_SHIP')
  await mkdir(join(root, '.local'))
  await writeFile(join(root, '.local', 'ai-worker.json'), 'TEST_PRIVATE_CONFIG_MUST_NOT_SHIP')
  await writeFile(join(root, 'server/community', 'private.sqlite'), 'TEST_DB_MUST_NOT_SHIP')
  const result = await packageCommunity({ root, revision })
  const names = await allFiles(result.destination)
  assert.deepEqual(names.sort(), [...COMMUNITY_RELEASE_FILES, 'package.json', 'deploy/community.env.example', 'README.md', 'manifest.json'].sort())
  const manifest = JSON.parse(await readFile(join(result.destination, 'manifest.json'), 'utf8'))
  assert.equal(manifest.sourceCommit, revision)
  for (const file of manifest.files) {
    const bytes = await readFile(join(result.destination, file.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
    assert.equal(bytes.length, file.bytes)
    assert.ok(!bytes.includes(Buffer.from('TEST_SECRET_MUST_NOT_SHIP')))
  }
  const env = await readFile(join(result.destination, 'deploy/community.env.example'), 'utf8')
  assert.match(env, /COMMUNITY_HOST=127\.0\.0\.1/)
  assert.match(env, /COMMUNITY_OPEN_REGISTRATION=0/)
  assert.match(env, /COMMUNITY_ALLOW_AUTO_PUBLISH=0/)
  assert.ok(env.match(/COMMUNITY_WORKER_TOKEN=(.*)/)[1].length < 32)
})

test('packaged modules initialize the actual SQLite schema without frontend, service start or model credentials', async t => {
  const { root } = await fixture(t)
  const { destination } = await packageCommunity({ root, revision })
  const smoke = `import {instruments} from './assets/instruments.js'; import {createPublicCommunityHandler} from './server/community/public-http.mjs'; const handler=createPublicCommunityHandler({catalog:instruments.filter(i=>i.chains.some(c=>c>0)),path:':memory:',origin:'https://community-api.example.com',browserOrigins:['https://ai-chain-prototype.vercel.app'],workerToken:'fixture-only-token'.padEnd(48,'x')}); handler.close(); console.log('packaged-sqlite-ok')`
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', smoke], { cwd: destination, encoding: 'utf8' })
  assert.match(output, /packaged-sqlite-ok/)
  for (const entry of ['community-server.mjs', 'community-account.mjs', 'community-backup.mjs']) {
    execFileSync(process.execPath, ['--check', join(destination, 'scripts', 'community', entry)], { stdio: 'pipe' })
  }
})

test('existing release and destinations outside the ignored release directory are rejected without overwrite', async t => {
  const { root, outer } = await fixture(t)
  const { destination } = await packageCommunity({ root, revision })
  const manifest = await readFile(join(destination, 'manifest.json'), 'utf8')
  await assert.rejects(packageCommunity({ root, revision }), error => error.code === 'EEXIST')
  assert.equal(await readFile(join(destination, 'manifest.json'), 'utf8'), manifest)
  await assert.rejects(packageCommunity({ root, revision, output: join(outer, 'outside') }), /directly inside/)
  await assert.rejects(packageCommunity({ root, revision: '../../bad' }), /40-character/)
})

test('source directory symlinks or Windows junctions cannot redirect allowlisted files', async t => {
  const { root, outer } = await fixture(t), original = join(root, 'server/community'), relocated = join(outer, 'redirected-community')
  assert.ok(isInside(outer, original) && isInside(outer, relocated))
  await rename(original, relocated)
  await symlink(relocated, original, 'junction')
  await assert.rejects(packageCommunity({ root, revision }), /symlinks or junctions/)
})

test('output ancestor symlinks or Windows junctions cannot redirect release writes', async t => {
  const { root, outer } = await fixture(t), redirected = join(outer, 'redirected-output')
  await mkdir(redirected)
  await mkdir(join(root, '.local'))
  await symlink(redirected, join(root, '.local/releases'), 'junction')
  await assert.rejects(packageCommunity({ root, revision }), /normal directory/)
  assert.deepEqual(await readdir(redirected), [])
})
