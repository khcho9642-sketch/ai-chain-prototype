import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPublishedDebates } from '../community/debate.mjs'

/** Copy only reviewed manifest-listed days, never private generation artifacts. */
export async function buildDebatePublication(source, output) {
  try { await lstat(join(source, 'data', 'debate', 'index.json')) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  const publication = await loadPublishedDebates(source, { allowMissing: true })
  if (!publication.index) return
  const directory = join(output, 'data', 'debate')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.json'), JSON.stringify(publication.index) + '\n')
  await Promise.all(publication.days.map(day => writeFile(join(directory, day.date + '.json'), JSON.stringify(day) + '\n')))
}
