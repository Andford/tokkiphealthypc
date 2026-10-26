/**
 * The first version saved a few screen preferences under the original app's
 * name (`kudu…`). Move them to `tokkip…` once, before anything reads them.
 */
export function moveOldKeys(storage: Storage | undefined = globalThis.localStorage): void {
  try {
    if (!storage) return
    const old: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && /^kudu[:._-]/.test(key)) old.push(key)
    }
    for (const key of old) {
      const value = storage.getItem(key)
      const next = 'tokkip' + key.slice(4)
      if (value !== null && storage.getItem(next) === null) storage.setItem(next, value)
      storage.removeItem(key)
    }
  } catch {
    /* storage blocked: nothing to move */
  }
}

moveOldKeys()
