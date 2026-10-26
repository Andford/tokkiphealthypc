import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'

// ─── Constants ───────────────────────────────────────────────

const MAX_RULE_CONTENT_BYTES = 1 * 1024 * 1024 // 1 MB per rule file
const MAX_RULE_COUNT = 10_000

// ─── Types ───────────────────────────────────────────────────

export interface YaraRuleFile {
  filename: string
  content: string
}

export interface YaraRuleBundle {
  version: string
  updatedAt: string
  sha256: string
  rules: YaraRuleFile[]
}

interface YaraRulesMetadata {
  version: string
  updatedAt: string
  rulesCount: number
  sha256: string
}

// ─── Paths ───────────────────────────────────────────────────

let _dataDir: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'Dev')
  }
  return _dataDir
}

function getCachedRulesDir(): string {
  return join(getDataDir(), 'yara-rules')
}

function getMetadataPath(): string {
  return join(getCachedRulesDir(), 'metadata.json')
}

/** List .yar files in a directory. */
function listYarFiles(dir: string): string[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yar'))
      .sort()
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

// ─── Cached rule files (downloaded from cloud, persisted to disk) ──

/** Get paths to cached YARA rule files. */
export function getCachedRulePaths(): string[] {
  return listYarFiles(getCachedRulesDir())
}

/**
 * Get all YARA rule file paths.
 * Rules are downloaded from the cloud on first launch and cached locally.
 */
export function getAllRulePaths(): string[] {
  return getCachedRulePaths()
}

export function getRulesMetadata(): YaraRulesMetadata | null {
  try {
    const path = getMetadataPath()
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!validateMetadata(parsed)) return null
    return parsed as YaraRulesMetadata
  } catch {
    return null
  }
}

function validateMetadata(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
  const obj = raw as Record<string, unknown>
  return (
    typeof obj.version === 'string' &&
    obj.version.length > 0 &&
    obj.version.length <= 100 &&
    typeof obj.updatedAt === 'string' &&
    obj.updatedAt.length > 0 &&
    obj.updatedAt.length <= 100 &&
    typeof obj.rulesCount === 'number' &&
    obj.rulesCount >= 0 &&
    typeof obj.sha256 === 'string' &&
    obj.sha256.length > 0 &&
    obj.sha256.length <= 128
  )
}

// ─── Bundle validation ───────────────────────────────────────

export function validateRuleBundle(raw: unknown): YaraRuleBundle | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null

  const obj = raw as Record<string, unknown>
  if (typeof obj.version !== 'string' || obj.version.length === 0 || obj.version.length > 100)
    return null
  if (typeof obj.updatedAt !== 'string' || obj.updatedAt.length === 0 || obj.updatedAt.length > 100)
    return null
  if (typeof obj.sha256 !== 'string' || obj.sha256.length === 0 || obj.sha256.length > 128)
    return null

  if (!Array.isArray(obj.rules) || obj.rules.length === 0 || obj.rules.length > MAX_RULE_COUNT)
    return null

  const rules: YaraRuleFile[] = []
  for (const item of obj.rules) {
    if (typeof item !== 'object' || item === null) return null
    const entry = item as Record<string, unknown>
    if (typeof entry.filename !== 'string' || !entry.filename.endsWith('.yar')) return null
    if (typeof entry.content !== 'string' || entry.content.length === 0) return null
    if (entry.content.length > MAX_RULE_CONTENT_BYTES) return null
    if (
      entry.filename.includes('/') ||
      entry.filename.includes('\\') ||
      entry.filename.includes('..')
    )
      return null
    rules.push({ filename: entry.filename, content: entry.content })
  }

  return {
    version: obj.version,
    updatedAt: obj.updatedAt,
    sha256: obj.sha256,
    rules
  }
}

/**
 * Compute the expected SHA-256 hash for a rule bundle.
 * Hash is over concatenated content fields, sorted by filename.
 */
export function computeBundleHash(rules: YaraRuleFile[]): string {
  // Use plain < > comparison (not localeCompare) for deterministic cross-platform sorting
  const sorted = [...rules].sort((a, b) =>
    a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0
  )
  const combined = sorted.map((r) => r.content).join('')
  return createHash('sha256').update(combined).digest('hex')
}

// ─── Local rules (Tokkip Healthy PC) ─────────────────────────

/**
 * Tokkip Healthy PC has no cloud: YARA rules are .yar files you drop in the
 * rules folder (it opens from the Database tab). This re-reads that folder,
 * records what's there and tells the engine to reload.
 */
export function reloadLocalRules(): {
  success: boolean
  error?: string
  folder: string
  stats?: { rulesCount: number; version: string }
} {
  const folder = getCachedRulesDir()
  try {
    mkdirSync(folder, { recursive: true })
    const files = listYarFiles(folder)
    const hash = createHash('sha256')
    for (const f of files) hash.update(readFileSync(f))
    const sha256 = hash.digest('hex')
    const meta: YaraRulesMetadata = {
      version: files.length ? 'local-' + sha256.slice(0, 8) : 'local',
      updatedAt: new Date().toISOString(),
      rulesCount: files.length,
      sha256
    }
    writeFileSync(getMetadataPath(), JSON.stringify(meta, null, 2))
    return { success: true, folder, stats: { rulesCount: files.length, version: meta.version } }
  } catch (err) {
    return { success: false, folder, error: err instanceof Error ? err.message : String(err) }
  }
}

export function localRulesFolder(): string {
  return getCachedRulesDir()
}
