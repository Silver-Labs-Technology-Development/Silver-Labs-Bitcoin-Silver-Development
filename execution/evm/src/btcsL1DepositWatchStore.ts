import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ProtocolError } from './blockProcessor.js'

export const BTCS_L1_DEPOSIT_WATCH_FORMAT = 'btcs-l2-btcs-l1-deposit-watch'
export const BTCS_L1_DEPOSIT_WATCH_VERSION = 1
export const BTCS_L1_DEPOSIT_WATCH_FILE = 'deposit-watch.json'

const HASH_RE = /^[0-9a-f]{64}$/
const SCRIPT_RE = /^(?:[0-9a-f]{2})+$/
const MAX_WATCH_BYTES = 2 * 1024 * 1024

export type WatchedBlock = Readonly<{ height: number; hash: string }>

export type BtcsL1DepositWatchState = Readonly<{
  format: typeof BTCS_L1_DEPOSIT_WATCH_FORMAT
  version: typeof BTCS_L1_DEPOSIT_WATCH_VERSION
  depositScriptPubKeyHex: string
  requiredConfirmations: number
  startHeight: number
  reorgWindowBlocks: number
  history: readonly WatchedBlock[]
}>

export type BtcsL1DepositWatchConfig = Readonly<{
  depositScriptPubKeyHex: string
  requiredConfirmations: number
  startHeight: number
  reorgWindowBlocks: number
}>

function validateConfig(config: BtcsL1DepositWatchConfig): void {
  if (
    typeof config.depositScriptPubKeyHex !== 'string' ||
    !SCRIPT_RE.test(config.depositScriptPubKeyHex) ||
    config.depositScriptPubKeyHex.startsWith('6a')
  ) {
    throw new ProtocolError('deposit watcher requires a canonical non-OP_RETURN payment script')
  }
  if (!Number.isSafeInteger(config.requiredConfirmations) || config.requiredConfirmations < 1) {
    throw new ProtocolError('deposit watcher confirmation requirement must be positive')
  }
  if (!Number.isSafeInteger(config.startHeight) || config.startHeight < 1) {
    throw new ProtocolError('deposit watcher start height must be a positive safe integer')
  }
  if (
    !Number.isSafeInteger(config.reorgWindowBlocks) ||
    config.reorgWindowBlocks < 1 ||
    config.reorgWindowBlocks > 10_000
  ) {
    throw new ProtocolError('deposit watcher reorg window must be between 1 and 10000 blocks')
  }
}

function normalizeHash(hash: unknown, label: string): string {
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
    throw new ProtocolError(label + ' must be a 64-character lowercase block hash')
  }
  return hash
}

function validateState(
  value: unknown,
  config: BtcsL1DepositWatchConfig,
): BtcsL1DepositWatchState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('deposit watcher state must be a JSON object')
  }
  const state = value as Record<string, unknown>
  const expectedKeys = [
    'format', 'version', 'depositScriptPubKeyHex', 'requiredConfirmations',
    'startHeight', 'reorgWindowBlocks', 'history',
  ]
  if (
    Object.keys(state).length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(state, key))
  ) {
    throw new ProtocolError('deposit watcher state has missing or unsupported fields')
  }
  if (
    state.format !== BTCS_L1_DEPOSIT_WATCH_FORMAT ||
    state.version !== BTCS_L1_DEPOSIT_WATCH_VERSION
  ) {
    throw new ProtocolError('unsupported deposit watcher state format or version')
  }
  if (
    state.depositScriptPubKeyHex !== config.depositScriptPubKeyHex ||
    state.requiredConfirmations !== config.requiredConfirmations ||
    state.startHeight !== config.startHeight ||
    state.reorgWindowBlocks !== config.reorgWindowBlocks
  ) {
    throw new ProtocolError('deposit watcher configuration does not match its persisted cursor')
  }
  if (!Array.isArray(state.history) || state.history.length < 1 ||
      state.history.length > config.reorgWindowBlocks + 1) {
    throw new ProtocolError('deposit watcher block history is malformed or exceeds its bound')
  }
  const history: WatchedBlock[] = []
  for (let index = 0; index < state.history.length; index += 1) {
    const item = state.history[index]
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ProtocolError('deposit watcher block history entry is malformed')
    }
    const entry = item as Record<string, unknown>
    if (
      Object.keys(entry).length !== 2 ||
      !Number.isSafeInteger(entry.height) ||
      (entry.height as number) < config.startHeight - 1 ||
      (index > 0 && entry.height !== history[index - 1]!.height + 1) ||
      typeof entry.hash !== 'string' ||
      !HASH_RE.test(entry.hash)
    ) {
      throw new ProtocolError('deposit watcher block history is not a contiguous canonical sequence')
    }
    history.push({ height: entry.height as number, hash: entry.hash })
  }
  return {
    format: BTCS_L1_DEPOSIT_WATCH_FORMAT,
    version: BTCS_L1_DEPOSIT_WATCH_VERSION,
    depositScriptPubKeyHex: config.depositScriptPubKeyHex,
    requiredConfirmations: config.requiredConfirmations,
    startHeight: config.startHeight,
    reorgWindowBlocks: config.reorgWindowBlocks,
    history,
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

export class BtcsL1DepositWatchStore {
  readonly directory: string
  private state: BtcsL1DepositWatchState
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(directory: string, state: BtcsL1DepositWatchState) {
    this.directory = directory
    this.state = state
  }

  static async create(
    directory: string,
    config: BtcsL1DepositWatchConfig,
    initialBlockHash: string,
  ): Promise<BtcsL1DepositWatchStore> {
    validateConfig(config)
    const resolved = resolve(directory)
    await mkdir(resolved, { recursive: true, mode: 0o700 })
    const path = join(resolved, BTCS_L1_DEPOSIT_WATCH_FILE)
    try {
      await lstat(path)
      throw new ProtocolError('deposit watcher state already exists; refusing to reset its cursor')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const state = validateState({
      format: BTCS_L1_DEPOSIT_WATCH_FORMAT,
      version: BTCS_L1_DEPOSIT_WATCH_VERSION,
      ...config,
      history: [{ height: config.startHeight - 1, hash: normalizeHash(initialBlockHash, 'initial block hash') }],
    }, config)
    const store = new BtcsL1DepositWatchStore(resolved, state)
    await store.persist(state)
    return store
  }

  static async open(
    directory: string,
    config: BtcsL1DepositWatchConfig,
  ): Promise<BtcsL1DepositWatchStore> {
    validateConfig(config)
    const resolved = resolve(directory)
    const path = join(resolved, BTCS_L1_DEPOSIT_WATCH_FILE)
    let info
    try {
      info = await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ProtocolError('deposit watcher cursor is missing; refusing to initialize or reset it')
      }
      throw error
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_WATCH_BYTES) {
      throw new ProtocolError('deposit watcher cursor is not a regular file or exceeds its size limit')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch {
      throw new ProtocolError('deposit watcher cursor contains invalid JSON')
    }
    return new BtcsL1DepositWatchStore(resolved, validateState(parsed, config))
  }

  get snapshot(): BtcsL1DepositWatchState {
    return { ...this.state, history: this.state.history.map((entry) => ({ ...entry })) }
  }

  async rewindTo(height: number, hash: string): Promise<void> {
    return this.enqueue(async () => {
      const normalizedHash = normalizeHash(hash, 'rewind block hash')
      const index = this.state.history.findIndex(
        (entry) => entry.height === height && entry.hash === normalizedHash,
      )
      if (index < 0) throw new ProtocolError('rewind target is outside retained deposit watcher history')
      const next = validateState({
        ...this.state,
        history: this.state.history.slice(0, index + 1),
      }, this.configFromState())
      await this.persist(next)
      this.state = next
    })
  }

  async appendBlock(height: number, hash: string): Promise<void> {
    return this.enqueue(async () => {
      if (!Number.isSafeInteger(height) || height !== this.cursorHeight + 1) {
        throw new ProtocolError('deposit watcher cursor blocks must be appended in order')
      }
      const nextHistory = [
        ...this.state.history,
        { height, hash: normalizeHash(hash, 'scanned block hash') },
      ].slice(-(this.state.reorgWindowBlocks + 1))
      const next = validateState({ ...this.state, history: nextHistory }, this.configFromState())
      await this.persist(next)
      this.state = next
    })
  }

  get cursorHeight(): number {
    return this.state.history.at(-1)!.height
  }

  get cursorHash(): string {
    return this.state.history.at(-1)!.hash
  }

  private configFromState(): BtcsL1DepositWatchConfig {
    return {
      depositScriptPubKeyHex: this.state.depositScriptPubKeyHex,
      requiredConfirmations: this.state.requiredConfirmations,
      startHeight: this.state.startHeight,
      reorgWindowBlocks: this.state.reorgWindowBlocks,
    }
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release!: () => void
    this.mutationTail = new Promise<void>((resolvePromise) => { release = resolvePromise })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async persist(state: BtcsL1DepositWatchState): Promise<void> {
    const path = join(this.directory, BTCS_L1_DEPOSIT_WATCH_FILE)
    const temporaryPath = join(this.directory, '.deposit-watch.' + randomUUID() + '.tmp')
    const contents = Buffer.from(JSON.stringify(state, null, 2) + '\n', 'utf8')
    if (contents.byteLength > MAX_WATCH_BYTES) {
      throw new ProtocolError('deposit watcher cursor exceeds its size limit')
    }
    let handle: Awaited<ReturnType<typeof open>> | undefined
    let renamed = false
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(contents)
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporaryPath, path)
      renamed = true
      await syncDirectory(this.directory)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      if (!renamed) await unlink(temporaryPath).catch(() => undefined)
      throw new ProtocolError(
        'could not persist deposit watcher cursor: ' +
        (error instanceof Error ? error.message : String(error)),
      )
    }
  }
}
