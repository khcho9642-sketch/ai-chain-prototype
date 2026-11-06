import { createHash } from 'node:crypto'
import { get, put, BlobPreconditionFailedError } from '@vercel/blob'
import { debateVoteStorageConflict } from './debate-votes.mjs'

const MAX_BYTES = 32 * 1024 * 1024
export function debateVotePath(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(id)) throw new Error('Invalid debate id')
  return 'debate-votes/v1/' + createHash('sha256').update(id).digest('hex') + '.json'
}

/** Private Blob CAS reuses the existing store token; no totals are static public assets. */
export function createBlobDebateVoteStore({ sdk = { get, put, BlobPreconditionFailedError } } = {}) {
  async function read(id) {
    const response = await sdk.get(debateVotePath(id), { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(8000) })
    if (response === null) return null
    if (response.statusCode !== 200 || !response.stream || typeof response.blob?.etag !== 'string' || !response.blob.etag ||
      !Number.isSafeInteger(response.blob.size) || response.blob.size < 0 || response.blob.size > MAX_BYTES) throw new Error('Invalid vote storage response')
    let size = 0; const chunks = [], reader = response.stream.getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Vote storage exceeds capacity') }
        chunks.push(Buffer.from(chunk.value))
      }
    } finally { reader.releaseLock() }
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), etag: response.blob.etag }
  }
  async function write(id, value, { etag } = {}) {
    if (etag !== null && (typeof etag !== 'string' || !etag)) throw new Error('An ETag or explicit null is required')
    const encoded = JSON.stringify(value)
    if (Buffer.byteLength(encoded) > MAX_BYTES) throw new Error('Vote storage exceeds capacity')
    try {
      const result = await sdk.put(debateVotePath(id), encoded, { access: 'private', addRandomSuffix: false, allowOverwrite: etag !== null,
        ...(etag !== null ? { ifMatch: etag } : {}), contentType: 'application/json; charset=utf-8', cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000) })
      if (typeof result?.etag !== 'string' || !result.etag) throw new Error('Missing vote storage ETag')
      return { etag: result.etag }
    } catch (error) {
      if (sdk.BlobPreconditionFailedError && error instanceof sdk.BlobPreconditionFailedError) throw debateVoteStorageConflict()
      if (etag === null && await read(id)) throw debateVoteStorageConflict()
      throw error
    }
  }
  return { read, write }
}
