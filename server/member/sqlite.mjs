import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** D1-shaped local adapter. Only the development server/tests import node:sqlite. */
export function createMemberDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const sqlite = new DatabaseSync(path)
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  sqlite.exec(readFileSync(new URL('../../deploy/auth/0001-members.sql', import.meta.url), 'utf8'))
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
