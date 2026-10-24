import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { open, lstat, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const CHAIN_DIRECTORY_LOCK_FILENAME = '.btcs-l2-chain-write.lock'
export const DEFAULT_CHAIN_DIRECTORY_LOCK_TIMEOUT_MS = 5 * 60 * 1000

const LOCK_FORMAT = 'btcs-l2-chain-directory-lock'
const LOCK_VERSION = 1
const MAX_LOCK_BYTES = 4 * 1024
const POLL_INTERVAL_MS = 25
const CORRUPT_OWNER_GRACE_MS = 1_000
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type LockOwner = Readonly<{
  format: typeof LOCK_FORMAT
  version: typeof LOCK_VERSION
  host: string
  pid: number
  token: string
  startedAtMs: number
}>

export type ChainDirectoryLockOwnerSummary = Readonly<{
  host: string
  pid: number
  startedAtMs: number
}>

export class ChainDirectoryLockError extends Error {
  override name = 'ChainDirectoryLockError'

  constructor(
    message: string,
    readonly owner?: ChainDirectoryLockOwnerSummary,
  ) {
    super(message)
  }
}

function lockPath(directory: string): string {
  return resolve(directory, CHAIN_DIRECTORY_LOCK_FILENAME)
}

function ownerSummary(owner: LockOwner): ChainDirectoryLockOwnerSummary {
  return { host: owner.host, pid: owner.pid, startedAtMs: owner.startedAtMs }
}

function parseOwner(value: unknown): LockOwner {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ChainDirectoryLockError('chain directory lock owner is not an object')
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.format !== LOCK_FORMAT ||
    candidate.version !== LOCK_VERSION ||
    typeof candidate.host !== 'string' ||
    candidate.host.length === 0 ||
    candidate.host.length > 255 ||
    !Number.isSafeInteger(candidate.pid) ||
    (candidate.pid as number) <= 0 ||
    typeof candidate.token !== 'string' ||
    !TOKEN_RE.test(candidate.token) ||
    !Number.isSafeInteger(candidate.startedAtMs) ||
    (candidate.startedAtMs as number) <= 0
  ) {
    throw new ChainDirectoryLockError('chain directory lock owner metadata is malformed')
  }
  return {
    format: LOCK_FORMAT,
    version: LOCK_VERSION,
    host: candidate.host,
    pid: candidate.pid as number,
    token: candidate.token,
    startedAtMs: candidate.startedAtMs as number,
  }
}

async function readOwner(path: string): Promise<LockOwner | undefined> {
  let bytes: Buffer
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new ChainDirectoryLockError('chain directory lock is not a regular file')
    }
    bytes = await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (bytes.byteLength === 0) return undefined
  if (bytes.byteLength > MAX_LOCK_BYTES) {
    throw new ChainDirectoryLockError('chain directory lock owner exceeds the size limit')
  }
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new ChainDirectoryLockError('chain directory lock owner metadata is malformed')
  }
  return parseOwner(value)
}

function ownerProcessIsAlive(owner: LockOwner): boolean {
  if (owner.host !== hostname()) return true
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function releaseLock(
  path: string,
  owner: LockOwner,
  device: number,
  inode: number,
): Promise<void> {
  const current = await readOwner(path)
  if (current === undefined || current.token !== owner.token) {
    throw new ChainDirectoryLockError(
      'chain directory lock ownership changed; refusing to remove another owner\'s lock',
      ownerSummary(owner),
    )
  }
  const info = await lstat(path)
  if (info.isSymbolicLink() || info.dev !== device || info.ino !== inode) {
    throw new ChainDirectoryLockError(
      'chain directory lock file identity changed; refusing to remove it',
      ownerSummary(owner),
    )
  }
  await unlink(path)
  await syncDirectory(resolve(path, '..'))
}

/**
 * Serialize operations that read or mutate one chain directory across Node
 * processes. The exclusive file creation is the lock primitive. A crashed
 * owner is detected and reported, but its lock is never removed automatically:
 * callers must verify that the owner is stopped before manual stale-lock cleanup.
 */
export async function withChainDirectoryLock<T>(
  directory: string,
  operation: () => Promise<T>,
  timeoutMs = DEFAULT_CHAIN_DIRECTORY_LOCK_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new ChainDirectoryLockError('chain directory lock timeout must be a non-negative integer')
  }
  const absoluteDirectory = resolve(directory)
  const path = lockPath(absoluteDirectory)
  const startedWaitingAt = Date.now()
  let malformedOwnerFirstSeenAt: number | undefined

  while (true) {
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(path, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner: LockOwner | undefined
      try {
        owner = await readOwner(path)
        malformedOwnerFirstSeenAt = undefined
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue
        if (!(readError instanceof ChainDirectoryLockError)) throw readError
        if (malformedOwnerFirstSeenAt === undefined) {
          malformedOwnerFirstSeenAt = Date.now()
        }
        if (Date.now() - malformedOwnerFirstSeenAt >= CORRUPT_OWNER_GRACE_MS) {
          throw readError
        }
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      if (owner !== undefined && !ownerProcessIsAlive(owner)) {
        throw new ChainDirectoryLockError(
          `stale chain directory lock owned by stopped process ${owner.pid} on ${owner.host}; verify that the process is stopped, then remove ${path}`,
          ownerSummary(owner),
        )
      }
      if (Date.now() - startedWaitingAt >= timeoutMs) {
        const details = owner === undefined
          ? 'owner metadata is still being written'
          : `owned by process ${owner.pid} on ${owner.host}`
        throw new ChainDirectoryLockError(
          `timed out waiting for chain directory lock ${path} (${details})`,
          owner === undefined ? undefined : ownerSummary(owner),
        )
      }
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    const owner: LockOwner = {
      format: LOCK_FORMAT,
      version: LOCK_VERSION,
      host: hostname(),
      pid: process.pid,
      token: randomUUID(),
      startedAtMs: Date.now(),
    }
    let identity: Awaited<ReturnType<typeof handle.stat>> | undefined
    try {
      identity = await handle.stat()
      await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      await syncDirectory(absoluteDirectory)
    } catch (error) {
      await handle.close().catch(() => undefined)
      if (identity !== undefined) {
        try {
          const current = await lstat(path)
          if (!current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) {
            await unlink(path)
            await syncDirectory(absoluteDirectory).catch(() => undefined)
          }
        } catch {
          // Preserve the original acquisition error; an uncertain lock remains fail-closed.
        }
      }
      throw error
    }

    try {
      return await operation()
    } finally {
      if (identity === undefined) {
        throw new ChainDirectoryLockError('chain directory lock identity was not recorded')
      }
      await releaseLock(path, owner, identity.dev, identity.ino)
    }
  }
}

export function chainDirectoryLockPath(directory: string): string {
  return lockPath(directory)
}
