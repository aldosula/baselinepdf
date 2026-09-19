import type { AnyObj, PageInfo } from './types'
import { idbDel, idbGet, idbSet } from './idb'

/** How many documents stay in the drawer, and how big one may be before we
 *  stop keeping its bytes. Browsers give a generous quota but not an infinite
 *  one, and three documents is what the drawer shows. */
export const MAX_RECENTS = 3
const MAX_KEPT_BYTES = 80 * 1024 * 1024

export type RecentDoc = {
  id: string
  name: string
  pageCount: number
  size: number
  updatedAt: number
  edits: number
  /** small JPEG of the first page */
  thumb?: string
  /** true when the file was too large to keep, so only the entry survives */
  bytesDropped?: boolean
}

const INDEX = 'recents.index'
const bytesKey = (id: string) => `recents.bytes.${id}`
const editsKey = (id: string) => `recents.edits.${id}`

/** Name plus byte length: opening the same file twice lands on the same entry
 *  instead of filling the drawer with copies of one document. */
export const recentId = (name: string, size: number) =>
  `${name.replace(/[^\w.-]+/g, '_').slice(0, 60)}.${size}`

export const listRecents = async (): Promise<RecentDoc[]> =>
  ((await idbGet<RecentDoc[]>(INDEX)) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)

async function writeIndex(list: RecentDoc[]) {
  const kept = list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECENTS)
  const dropped = list.slice(MAX_RECENTS)
  for (const d of dropped) {
    await idbDel(bytesKey(d.id))
    await idbDel(editsKey(d.id))
  }
  await idbSet(INDEX, kept)
  return kept
}

export async function touchRecent(meta: Omit<RecentDoc, 'updatedAt'> & { updatedAt?: number }) {
  const list = await listRecents()
  const existing = list.find(d => d.id === meta.id)
  const next: RecentDoc = {
    ...existing,
    ...meta,
    thumb: meta.thumb ?? existing?.thumb,
    updatedAt: meta.updatedAt ?? Date.now(),
  }
  return writeIndex([next, ...list.filter(d => d.id !== meta.id)])
}

/** The bytes never change, so they are written once when the file is opened. */
export async function keepBytes(id: string, bytes: Uint8Array) {
  if (bytes.length > MAX_KEPT_BYTES) return false
  await idbSet(bytesKey(id), bytes)
  return true
}

/** The edits change constantly, so they are written on their own key. */
export const keepEdits = (id: string, edits: { objects: AnyObj[]; pages: PageInfo[] }) =>
  idbSet(editsKey(id), edits)

export const readBytes = (id: string) => idbGet<Uint8Array>(bytesKey(id))
export const readEdits = (id: string) => idbGet<{ objects: AnyObj[]; pages: PageInfo[] }>(editsKey(id))

export async function forgetRecent(id: string) {
  await idbDel(bytesKey(id))
  await idbDel(editsKey(id))
  const list = (await listRecents()).filter(d => d.id !== id)
  await idbSet(INDEX, list)
  return list
}

export async function clearRecents() {
  for (const d of await listRecents()) {
    await idbDel(bytesKey(d.id))
    await idbDel(editsKey(d.id))
  }
  await idbSet(INDEX, [])
}

export function whenText(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
