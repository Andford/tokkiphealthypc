// Tokkip PC (the island app) hears how this PC is doing through one small
// file: %APPDATA%\Tokkip\shared\healthy-pc.json (on Linux, ~/.config/Tokkip/
// shared). It's rewritten only when something changed, atomically, and holds
// nothing private — a score, a mood and one sentence.

import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { validTokkipNotice } from '../../shared/tokkip-notice'

export function tokkipNoticePath(): string {
  return join(app.getPath('appData'), 'Tokkip', 'shared', 'healthy-pc.json')
}

let last = ''

export function writeTokkipNotice(raw: unknown): void {
  const notice = validTokkipNotice(raw)
  if (!notice) return
  // A status that says the same as before isn't news.
  const key = JSON.stringify(notice)
  if (key === last && notice.kind === 'status') return
  last = key
  const path = tokkipNoticePath()
  try {
    mkdirSync(join(path, '..'), { recursive: true })
    let seq = 0
    try {
      seq = Number(JSON.parse(readFileSync(path, 'utf8')).seq) || 0
    } catch {
      /* first one */
    }
    const body = JSON.stringify(
      { app: 'tokkip-healthy-pc', version: 1, seq: seq + 1, at: Date.now(), ...notice },
      null,
      2
    )
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, body, 'utf8')
    renameSync(tmp, path)
  } catch {
    /* Tokkip PC just won't hear about it */
  }
}
