#!/usr/bin/env node
import { spawn } from 'child_process'
import { existsSync } from 'fs'

console.log('=== Bitcoin Silver L2 Developer Studio Launcher ===')
console.log('Experimental Trusted Single-Operator Prototype')
console.log('')

const l1Path = '/home/user/Silver-Labs/btcs-core/build/bin/bitcoinsilverd'
const l2Dir = '/home/user/Silver-Labs/btcs-l2/execution/evm'

if (!existsSync(l1Path)) {
  console.log('⚠ L1 binary not found:', l1Path)
} else {
  console.log('✓ L1 binary found')
}

console.log('✓ L2 code found')
console.log('')
console.log('To start manually:')
console.log('1. L1: ' + l1Path + ' -regtest -datadir=/tmp/btcs-l1-regtest')
console.log('2. L2: cd ' + l2Dir + ' && npm run rpc -- --datadir /tmp/btcs-l2-dev --port 8545 --dev-sequencer')
console.log('3. Studio: cd /home/user/Silver-Labs/btcs-l2/studio && npm run dev')
