import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** D1-shaped local adapter. Only the development server/tests import node:sqlite. */
export function createMemberDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const sqlite = new DatabaseSync(path)
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  // Older local databases had no migration journal. The baseline is idempotent;
  // adopt an already-added nickname column when opening a manually migrated copy.
  try {
    sqlite.exec('CREATE TABLE IF NOT EXISTS member_local_migrations(name TEXT PRIMARY KEY, applied INTEGER NOT NULL)')
    const migrationRoot = new URL('../../deploy/auth/', import.meta.url)
    for (const name of readdirSync(migrationRoot).filter(name => /^\d{4}-[a-z0-9-]+\.sql$/.test(name)).sort()) {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        if (!sqlite.prepare('SELECT 1 FROM member_local_migrations WHERE name=?').get(name)) {
          const alreadyAdded = name === '0002-member-nicknames.sql' && sqlite.prepare('PRAGMA table_info(member_users)').all().some(column => column.name === 'nickname')
          if (!alreadyAdded) sqlite.exec(readFileSync(new URL(name, migrationRoot), 'utf8'))
          sqlite.prepare('INSERT INTO member_local_migrations(name,applied) VALUES(?,?)').run(name, Date.now())
        }
        sqlite.exec('COMMIT')
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    }
  } catch (error) { sqlite.close(); throw error }
  const prepare = sql => {
    let bindings = []
    const statement = {
      bind(...values) { bindings = values; return statement },
      async first(column) { const row = sqlite.prepare(sql).get(...bindings); return row ? (column ? row[column] : { ...row }) : null },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...bindings).map(row => ({ ...row })) } },
      async run() { const result = sqlite.prepare(sql).run(...bindings); return { success: true, results: [], meta: { changes: Number(result.changes) } } },
      execute() {
        const compiled = sqlite.prepare(sql)
        if (compiled.columns().length) return { success: true, results: compiled.all(...bindings).map(row => ({ ...row })) }
        const result = compiled.run(...bindings); return { success: true, results: [], meta: { changes: Number(result.changes) } }
      },
    }
    return statement
  }
  return { prepare, sqlite,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE')
      try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
    close() { sqlite.close() },
  }
}
