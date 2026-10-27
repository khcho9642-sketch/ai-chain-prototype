import { DatabaseSync, backup } from 'node:sqlite'
import { isAbsolute, resolve } from 'node:path'
import { open, unlink, chmod } from 'node:fs/promises'

const source = process.env.COMMUNITY_DB, destination = process.argv[2]
if (!source || !destination || !isAbsolute(source) || !isAbsolute(destination) || resolve(source) === resolve(destination)) {
  throw new Error('Set COMMUNITY_DB and provide a different absolute backup file path.')
}
// Exclusive reservation: never overwrite an existing backup. SQLite's online API includes committed WAL data.
const reservation = await open(destination, 'wx', 0o600); await reservation.close()
let db
try {
  db = new DatabaseSync(source, { readOnly: true })
  await backup(db, destination)
  await chmod(destination, 0o600)
  console.log('Consistent database backup completed. Store it outside the service host.')
} catch (error) { await unlink(destination).catch(() => {}); throw error }
finally { db?.close() }
