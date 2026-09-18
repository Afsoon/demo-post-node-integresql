import { createHash } from 'node:crypto'
import { glob, readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

/** Hash relative paths and contents in a fixed order, independent of checkout location or file metadata. */
export async function hashMigrationFiles(directory: string) {
  const files = (await Array.fromAsync(glob('**/*.{sql,json}', { cwd: directory })))
    .map((path) => path.split(sep).join('/'))
    .sort()

  if (files.length === 0) throw new Error(`No migration files found in ${directory}`)

  const entries = await Promise.all(files.map(async (path) => {
    const content = await readFile(join(directory, path))
    return [path, createHash('sha256').update(content).digest('hex')]
  }))

  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}
