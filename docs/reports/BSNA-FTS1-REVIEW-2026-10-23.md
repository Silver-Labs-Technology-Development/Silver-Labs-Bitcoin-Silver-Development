# BSNA-FTS1 — Independent Review Draft

## Review Date: 2026-10-23
## Status: READY_FOR_REVIEW
## Contract: contracts/token/BSNAFTS1.sol
## Proposal: docs/BSNA-FTS1-PROPOSAL.md revision 1

## Executive Summary
BSNA-FTS1 is a well-specified fungible token standard for BTCS L2 that extends ERC-20
with deterministic supply policy, burn, pause, and metadata rules. The reference
implementation is standalone, has no upgrade proxy, and takes no fee inside transfers.

## Contract Review
### Strengths
1. **Atomic amount units**: Every amount is an atomic unit; no scaling by `10 ** decimals()`.
   - This prevents the common ERC-20 mistake where minting `100` with 18 decimals creates
   `100 * 10^18` supply, obscuring the intended supply.

2. **Immutable policies**: Supply, burn, and pause policies are set at construction and
   cannot be changed. This provides strong guarantees for auditors.

3. **No fee on transfers**: The `transfer` function takes no fee, matching ERC-20 semantics
   and avoiding hidden taxation issues.

4. **Custom errors**: Uses Solidity custom errors (ZeroAddress, InsufficientBalance, etc.)
   instead of string revert, providing better gas efficiency and error clarity.

5. **No upgrade proxy**: The contract is standalone and cannot be upgraded, providing
   deterministic behavior for auditors.

6. **Metadata with content hash**: URI plus `bytes32` content hash, mutable only when
   construction allows it, provides strong metadata guarantees.

### Areas Requiring Clarification
1. **Initial supply with fixed policy**: When `Fixed` supply is chosen, the `initialSupply`
   must not exceed `maxSupply`. The `InitialSupplyExceedsCap` error handles this, but the
   interaction between `totalSupply`, `maxSupply`, and `initialSupple` needs careful
   testing at construction.

2. **Holder burn semantics**: `burn()` only works when `burnPolicy == BURN_HOLDER`. When
   `BURN_DISABLED`, the transaction reverts with `BurnDisabled`. The exact behavior when
   a user attempts to burn under the disabled policy should be clearly documented for
   users.

3. **Pausable behavior**: `pause()` only works when `pausePolicy == PAUSE_ADMIN`. When
   `PAUSE_DISABLED`, the transaction reverts with `InvalidPolicy`. Similar clarification
   needed for users.

## Implementation Review
### Code Quality
- Solidity 0.8.37 with `viaIR: true` and `evmVersion: london`
- No optimizer (`runs: 200`) - reasonable for a prototype
- 15 custom errors with clear names and meanings
- Modifiers for access control (`onlyAdmin`, `onlyAdmin`) and state checks
  (`whenNotPaused`)
- All state changes emit events for observability

### Test Coverage
- services/asset-service/tests/contract/bsnaFts1.test.ts passes 13/13 tests
- Tests cover: fixed supply mint refusal, explicit minter requirement and cap,
  burn policy, pause/unpause, allowance, zero address, metadata freeze/update,
  renounce, and admin transfer
- Tested on real local BTCS L2 development chain (not simulated)

## Specification Compliance
### BSNA-FTS1 Proposal Compliance (section 1-10)
| Feature | Proposal | Contract | Compliant |
|---|---|---|---|
| Atomic amounts | ✓ No scaling | ✓ No scaling | Yes |
| Decimals (immutable) | ✓ 0-18 range | ✓ Constructor arg | Yes |
| Supply policy | ✓ Fixed/AuthorizedMint | ✓ SUPPLY_FIXED/SUPPLY_AUTHORIZED_MINT | Yes |
| Burn policy | ✓ Disabled/Holder | ✓ BURN_DISABLED/BURN_HOLDER | Yes |
| Pause policy | ✓ Disabled/Admin | ✓ PAUSE_DISABLED/PAUSE_ADMIN | Yes |
| Metadata | ✓ URI + bytes32 hash | ✓ setMetadata with hash | Yes |
| ERC-20 surface | ✓ Standard functions | ✓ Standard functions | Yes |
| No transfer fees | ✓ Spec requirement | ✓ `transfer` takes no fee | Yes |
| No callbacks | ✓ Forbidden | ✓ No receiver hook in transfer | Yes |
| bsnaStandard() | ✓ Returns "BSNA-FTS1" | ✓ Returns "BSNA-FTS1" | Yes |
| bsnaVersion() | ✓ Returns "1" | ✓ Returns "1" | Yes |

## Security Assessment
### Attack Surface
1. **Zero address rejection**: `transfer`, `mint`, `burn`, `transferAdmin`,
   `renounceAdmin` all reject zero addresses. Well-handled.

2. **Insufficient balance**: `transfer` and `burn` check balances and revert
   with `InsufficientBalance`. Well-handled.

3. **Insufficient allowance**: `transferFrom` checks allowance and reverts
   with `InsufficientAllowance`. Well-handled.

4. **Mint only by minter**: When `AuthorizedMint`, only the minter can mint.
   When `Fixed`, minting is disabled. Well-handled.

5. **Burn only by holder**: When `HolderBurn`, only the token holder can burn.
   When `Disabled`, burning is disabled. Well-handled.

6. **Pause only by admin**: When `AdminPause`, admin can pause/unpause.
   When `Disabled`, pausing is disabled. Well-handled.

7. **Metadata mutation control**: `setMetadata` only works when `metadataMutable`
   is true. When false, `MetadataFrozen` error is reverted. Well-handled.

8. **Cap enforcement**: `SupplyCapExceeded` checked on mint when `maxSupply > 0`.
   When `maxSupply == 0`, no cap is enforced. Well-handled.

### Residual Risks
1. **Initial supply cap edge case**: If `Fixed` policy with `initialSupply == maxSupply == 0`,
   the supply is zero and no minting is possible. This is correct behavior but should
   be noted in documentation.

2. **No burn of zero amount**: `burn()` reverts if `amount == 0` with `AmountZero`.
   This prevents accidental no-op burns but should be documented.

3. **No self-burn restriction**: There's no explicit restriction against burning one's
   own tokens down to zero supply. The contract allows this, which is intentional
   for `HolderBurn` policy but should be noted.

## Conclusion
BSNA-FTS1 is a secure, well-specified token standard that fills a gap in the
BTCS L2 token ecosystem. The reference implementation correctly implements the
proposal and has test coverage for all specified behaviors. The independent
review recommends approval for use in SilverForge, with the following conditions:

1. Document the initial supply + cap edge case in SilverForge UI.
2. Add a note about self-burn behavior in the user-facing documentation.
3. Schedule a follow-up review after 3 months of production use.

## Recommendation
**APPROVE** for use in SilverForge as the standard fungible token profile.

## Reviewer
Independent Security Review
2026-10-23
