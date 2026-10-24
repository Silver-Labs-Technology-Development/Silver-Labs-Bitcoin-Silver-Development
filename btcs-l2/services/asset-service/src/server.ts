/**
 * Asset service entry point.
 *
 * Configuration comes exclusively from the environment. Storage credentials
 * are read here and never leave the server process.
 */

import { startAssetServerFromEnv } from './httpServer.js'

async function main(): Promise<void> {
  const server = await startAssetServerFromEnv(process.env)
  process.stdout.write(`BTCS asset service listening at ${server.url}\n`)
  process.stdout.write(`  upload route: POST ${server.url}/api/assets/images\n`)
  if (server.storageProvider === null) {
    process.stderr.write(
      `Storage is not configured: ${server.storageConfigurationError ?? 'unknown reason'}\n` +
        'Upload requests will be refused with HTTP 503 until the storage configuration is fixed.\n',
    )
  } else {
    process.stdout.write(
      `  storage provider: ${server.storageProvider} (${server.storageDurability}, ` +
        `portable: ${server.storagePortable})\n`,
    )
  }

  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    void server.close().then(
      () => {
        process.exitCode = 0
      },
      () => {
        process.exitCode = 1
      },
    )
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown startup error'
  process.stderr.write(`Unable to start the asset service: ${message}\n`)
  process.exitCode = 1
})
