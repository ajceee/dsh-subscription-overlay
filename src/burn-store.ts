/**
 * Burn ledger store (DSH 0.2): the schema-derived config cannot hold the
 * per-model ledger, so it lives in <home>/data/dsh-subscription-overlay/burn.json.
 * Atomic write (tmp + rename). Never leaves the host.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { appendBurn } from './index.js'

export type Burn = Record<string, Array<[number, number]>>

export function burnPath(home = process.env.DSH_HOME ?? join(homedir(), '.dsh')): string {
  return join(home, 'data', 'dsh-subscription-overlay', 'burn.json')
}

export async function readBurn(file = burnPath()): Promise<Burn> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Burn : {}
  } catch { return {} }
}

export async function writeBurn(burn: Burn, file = burnPath()): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(burn), 'utf8')
  await rename(tmp, file)
}

/** Append one sample (30d prune / 1000-per-model cap via appendBurn); returns the new ledger. */
export async function appendBurnStored(model: string, tokens: number, now = Date.now(), file = burnPath()): Promise<Burn> {
  const next = appendBurn(await readBurn(file), model, tokens, now)
  await writeBurn(next, file)
  return next
}

/** One-time migration: if burn.json is absent and legacy config.burn is non-empty, seed the file. */
export async function migrateBurn(legacy: Burn | undefined, file = burnPath()): Promise<Burn> {
  try { await readFile(file, 'utf8') } catch {
    if (legacy && Object.keys(legacy).length) { await writeBurn(legacy, file); return legacy }
  }
  return readBurn(file)
}
