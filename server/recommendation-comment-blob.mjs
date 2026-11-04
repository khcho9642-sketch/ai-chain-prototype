import { createHash } from 'node:crypto'
import { get, put, BlobPreconditionFailedError } from '@vercel/blob'
import { recommendationStorageConflict } from './recommendation-comments.mjs'

const MAX_STATE_BYTES = 32 * 1024 * 1024
export function recommendationCommentPath(reportId) {
  if (typeof reportId !== 'string' || !reportId || reportId.length > 160) throw new Error('Invalid report id')
  return 'recommendation-comments/v1/' + createHash('sha256').update(reportId).digest('hex') + '.json'
}

/**
 * Private blobs only. Uncached reads plus ETag-conditional overwrites provide CAS;
 * create-only writes ensure two simultaneous first comments cannot replace each other.
 */
export function createBlobRecommendationCommentStore({ sdk = { get, put, BlobPreconditionFailedError } } = {}) {
  async function read(reportId) {
    const result = await sdk.get(recommendationCommentPath(reportId), { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(8000) })
    if (result === null) return null
    if (result.statusCode !== 200 || !result.stream || typeof result.blob?.etag !== 'string' || !result.blob.etag ||
      !Number.isSafeInteger(result.blob.size) || result.blob.size < 0 || result.blob.size > MAX_STATE_BYTES) throw new Error('Invalid comment storage response')
    const chunks = []; let size = 0
    const reader = result.stream.getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_STATE_BYTES) { await reader.cancel(); throw new Error('Comment storage exceeds capacity') }
        chunks.push(Buffer.from(chunk.value))
      }
    } finally { reader.releaseLock() }
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), etag: result.blob.etag }
  }
  async function write(reportId, value, { etag } = {}) {
    if (etag !== null && (typeof etag !== 'string' || !etag)) throw new Error('An ETag or explicit null is required')
    const encoded = JSON.stringify(value)
    if (Buffer.byteLength(encoded) > MAX_STATE_BYTES) throw new Error('Comment storage exceeds capacity')
    try {
      const result = await sdk.put(recommendationCommentPath(reportId), encoded, {
        access: 'private', addRandomSuffix: false, allowOverwrite: etag !== null,
        ...(etag !== null ? { ifMatch: etag } : {}),
        contentType: 'application/json; charset=utf-8', cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000),
      })
      if (typeof result?.etag !== 'string' || !result.etag) throw new Error('Missing comment storage ETag')
      return { etag: result.etag }
    } catch (error) {
      if (sdk.BlobPreconditionFailedError && error instanceof sdk.BlobPreconditionFailedError) throw recommendationStorageConflict()
      // Blob's create-only collision is a generic BlobError. Confirm an existing
      // object with a consistent read instead of guessing from an error message.
      if (etag === null && await read(reportId)) throw recommendationStorageConflict()
      throw error
    }
  }
  return { read, write }
}
