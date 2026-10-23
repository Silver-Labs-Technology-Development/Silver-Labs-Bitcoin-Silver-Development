# BSNA-FTS1 — Bitcoin Silver Native Assets, Fungible Token Standard 1

Status: **PROPOSAL**. Not implemented. Not verified. Do not treat `BSNA20` as this standard.

Date: 2026-10-22
Branch: experimental/deposit-prelude-v1
Audience: the next implementation agent and reviewers

## 1. Purpose

BSNA-FTS1 is the fungible asset profile SilverForge should offer for tokens that execute on BTCS L2. It is wallet-compatible with ERC-20 so existing EVM tools can read balances and submit transfers. It is not a rename of ERC-20, of BEP-20, or of the draft `BSNA-20` profile already in this repository.

`contracts/token/BSNA20.sol` remains the existing draft. It wraps OpenZeppelin ERC-20, adds `IBSNA`, and mints whole tokens through `amount * 10 ** decimals()`. This proposal does not replace that file. A later change may add `contracts/token/BSNAFTS1.sol` beside it, with the conformance tests below, and only then can SilverForge offer BSNA-FTS1 as a deployable option.

## 2. Where it executes

- The contract runs on the BTCS L2 EVM.
- Gas is paid in the L2 native balance. That balance is the deposit unit defined by `SATOSHI_TO_WEI` (`10^10` wei per L1 satoshi, so 1 BTCS = `10^18` wei). The token contract does not choose the gas asset and must not accept its own token as gas.
- A BSNA-FTS1 deployment on BTCS L2 is not a BNB Smart Chain token and not a Solana SPL mint.
- If SilverForge later deploys a BEP-20-compatible contract or a native SPL mint, those are separate options with their own network, signer, and fee currency.

## 3. Differences from ERC-20 and from the current BSNA-20 draft

ERC-20 specifies the balance, allowance, and event surface. It does not specify supply policy, mint authority, burn, pause, metadata, or error types. BSNA-FTS1 keeps the ERC-20 surface and adds the rules below. `BSNA20` does not implement this set.

| Rule | ERC-20 | Current `BSNA20` | BSNA-FTS1 |
|---|---|---|---|
| Identifier | none | `bsnaProfile()` returns `"BSNA-20"` | `bsnaStandard()` returns `"BSNA-FTS1"` |
| Amount units | smallest unit, by convention | constructor and `mint` scale whole tokens by `10 ** decimals()` | every amount argument is an atomic unit; the contract must not scale it |
| Decimals | optional metadata | fixed OpenZeppelin default of 18 | immutable constructor argument, range 0 through 18 |
| Supply policy | unspecified | owner can always mint, with an optional cap | immutable `Fixed` or `AuthorizedMint`, chosen at construction |
| Burn | unspecified | absent | immutable `Disabled` or `HolderBurn` |
| Pause | unspecified | absent | immutable `Disabled` or `AdminPause` |
| Metadata | unspecified | one URI string | URI plus a `bytes32` content hash; mutable only when construction allows it |
| Errors | unspecified | one string revert | the custom errors in section 7 |
| Callbacks | none required | none | forbidden. No receiver hook and no fee taken inside `transfer` |

## 4. ERC-20 surface that must match

These functions and events use the standard selectors and signatures so a normal EVM wallet can import the contract:

- `name() → string`
- `symbol() → string`
- `decimals() → uint8`
- `totalSupply() → uint256`
- `balanceOf(address) → uint256`
- `allowance(address,address) → uint256`
- `transfer(address,uint256) → bool`
- `approve(address,uint256) → bool`
- `transferFrom(address,address,uint256) → bool`
- `Transfer(address indexed from, address indexed to, uint256 value)`
- `Approval(address indexed owner, address indexed spender, uint256 value)`

`transfer` and `transferFrom` move only the atomic amount. They return `true` on success. They do not take a fee, rebase balances, or call the recipient. A transfer to the zero address is rejected; burning has its own function. A transfer of zero is allowed and emits `Transfer`, matching common ERC-20 wallet behavior.

`approve` overwrites the previous allowance and emits `Approval`. The standard does not require an increase/decrease helper.

## 5. Identity, supply, and permissions

### 5.1 Identity

```solidity
function bsnaStandard() external pure returns (string memory); // "BSNA-FTS1"
function bsnaVersion() external pure returns (string memory);  // "1"
function decimals() external view returns (uint8);
```

`bsnaVersion()` is the standard revision, not a marketing version. Revision 1 is this document. A later revision must be a new document, not a silent change to deployed bytecode.

### 5.2 Constructor

The constructor receives:

- `name` and `symbol`, each 1 to 64 bytes after trimming is forbidden. The contract stores the exact argument.
- `decimals` in `0..=18`.
- `initialSupply` atomic units, minted to `initialAdmin` in the constructor. It may be zero.
- `maxSupply` atomic units. For `Fixed`, `maxSupply` must equal `initialSupply`. For `AuthorizedMint`, `maxSupply == 0` means no cap, and any other value must be greater than or equal to `initialSupply`.
- `supplyPolicy`: `Fixed` (0) or `AuthorizedMint` (1).
- `burnPolicy`: `Disabled` (0) or `HolderBurn` (1).
- `pausePolicy`: `Disabled` (0) or `AdminPause` (1).
- `metadataMutable`: if false, `setMetadata` reverts forever.
- `metadataURI` and `metadataHash`. The hash may be zero only when the URI is empty. A non-empty URI requires a non-zero hash. The contract does not fetch the URI.
- `initialAdmin`, which must not be the zero address.

No argument may be scaled by `10 ** decimals`.

### 5.3 Roles

- `admin()` is the only address that can change the admin, the minter, pause state, and metadata.
- `transferAdmin(address next)` moves the admin. `next` must not be zero. The previous admin loses the role in the same transaction.
- `renounceAdmin()` sets the admin to zero and permanently removes admin control. It does not change supply policy.
- `minter()` is used only for `AuthorizedMint`. It starts as the zero address, so construction does not grant an ongoing mint right unless `setMinter` is later called. `Fixed` rejects `setMinter` and `mint`.
- The admin and the minter are separate. The admin does not mint by virtue of being admin.

### 5.4 Mint and burn

- `mint(address to, uint256 amount)` requires `AuthorizedMint`, a non-zero minter, `msg.sender == minter()`, `to != address(0)`, `amount > 0`, the contract not paused, and `totalSupply + amount` not overflowing and not exceeding `maxSupply` when a cap is set.
- `burn(uint256 amount)` requires `HolderBurn`, `msg.sender` balance of at least `amount`, `amount > 0`, and the contract not paused. It decreases that holder's balance and `totalSupply`. Nobody can burn another holder's tokens.
- `Fixed` plus `HolderBurn` can reduce supply and cannot increase it again.

### 5.5 Pause

When `pausePolicy` is `AdminPause`, `pause()` and `unpause()` are admin-only. While paused, `transfer`, `transferFrom`, `mint`, and `burn` revert. Views, `approve`, admin transfer, and metadata updates still work. `Disabled` rejects both pause functions. Pause is not an upgrade and does not change balances.

## 6. Metadata and logo

The logo is not stored in the contract. The metadata document is JSON with exactly these top-level fields, matching the field set already used by the asset service: `name`, `description`, `image`, `external_url`, `attributes`.

- `image` is an `https` or `ipfs` URI, or a content-addressed URI produced by the asset service. It is not a `file:` URI and not an inline `data:` image.
- `metadataHash` is `sha256` of the raw metadata bytes.
- `setMetadata(string uri, bytes32 hash)` is admin-only and reverts when `metadataMutable` is false, when the contract is describing a frozen empty document incorrectly, or when a non-empty URI has a zero hash.
- Updating metadata does not change balances, supply, or the contract address.
- Who may update it is only `admin()`, and only when mutability was chosen at construction. Holders cannot reverse a frozen URI. A mutable URI can be replaced by the admin; the previous document is not retained on-chain.
- The asset service may store the image and document. The contract only stores the URI and hash. Local asset-service URIs are `local-only` and are not a public permanence guarantee.

## 7. Errors

The implementation must revert with these custom errors and must not use string `require` for these cases:

- `ZeroAddress()`
- `EmptyNameOrSymbol()`
- `NameOrSymbolTooLong()`
- `DecimalsOutOfRange()`
- `InvalidSupplyPolicy()`
- `FixedSupplyCapMismatch()`
- `InitialSupplyExceedsCap()`
- `MetadataHashRequired()`
- `InsufficientBalance(address account, uint256 balance, uint256 needed)`
- `InsufficientAllowance(address spender, uint256 allowance, uint256 needed)`
- `SupplyCapExceeded(uint256 supply, uint256 amount, uint256 cap)`
- `MintDisabled()`
- `BurnDisabled()`
- `Paused()`
- `NotAdmin(address caller)`
- `NotMinter(address caller)`
- `MetadataFrozen()`
- `AmountZero()`

Arithmetic uses Solidity 0.8 checked math. A balance or supply overflow reverts rather than wrapping.

## 8. Events beyond ERC-20

- `AdminTransferred(address indexed previousAdmin, address indexed newAdmin)`
- `MinterUpdated(address indexed previousMinter, address indexed newMinter)`
- `MetadataUpdated(string uri, bytes32 hash)`
- `PauseUpdated(bool paused)`

Mint emits ERC-20 `Transfer` from `address(0)`. Burn emits ERC-20 `Transfer` to `address(0)`. No second balance event is required.

## 9. Security invariants

- The contract has no upgrade proxy, no delegatecall route, and no selfdestruct.
- `transfer` and `transferFrom` do not call untrusted code.
- Mint cannot pass the cap, and `Fixed` cannot mint after construction.
- A failed transaction must not change balances. Gas is still charged by the L2 protocol, outside this contract.
- Privileged actions are `admin` or `minter` only, as specified above. There is no hidden owner in the OpenZeppelin `Ownable` sense unless the implementation maps `admin` onto it explicitly and the conformance tests observe `admin()`.
- Renouncing the admin does not grant the minter admin powers.
- The standard does not claim a bridge, a reserve, or backing by L1 BTCS. Depositing BTCS and deploying a token are different operations.

## 10. Conformance tests required before implementation can be called verified

The tests compile the reference contract and execute it on the existing BTCS L2 EVM harness, or on the asset-service contract runner if that runner uses the same compiler. They must fail if the behavior below is missing. Writing the tests without a contract, or a contract without these tests, does not complete the standard.

1. Selectors for the ERC-20 surface and `bsnaStandard()` match the signatures in this document.
2. `bsnaStandard()` is `BSNA-FTS1` and `bsnaVersion()` is `1`. A `BSNA-20` contract does not satisfy this test.
3. Constructor stores an unscaled `initialSupply` of atomic units. Decimals 6 with initial supply `1_500_000` yields `balanceOf(admin) == 1_500_000` and `totalSupply() == 1_500_000`, not `1_500_000 * 10^6`.
4. `Fixed` rejects `mint` from the admin and from every other address.
5. `AuthorizedMint` rejects minting until a minter is set, then accepts the minter and rejects the admin if the admin is not the minter.
6. The cap rejects the mint that would exceed it and accepts the mint that lands exactly on it.
7. `HolderBurn` decreases the caller's balance and supply. It rejects a burn larger than the balance and rejects a burn of someone else's tokens.
8. `Disabled` burn rejects `burn`.
9. `AdminPause` blocks transfer, transferFrom, mint, and burn, and allows them again after `unpause`. A non-admin cannot pause.
10. `Disabled` pause rejects `pause`.
11. `transferFrom` decreases allowance. An insufficient allowance or balance reverts with the custom error and leaves state unchanged.
12. Direct transfer to the zero address reverts. Burn to the zero address through `burn` succeeds when burn is enabled.
13. Metadata freeze rejects `setMetadata`. Mutable metadata accepts one update and stores the new hash.
14. A non-empty URI with a zero hash reverts at construction and at `setMetadata`.
15. `renounceAdmin` makes a later `setMinter`, `pause`, and `setMetadata` revert.
16. A deployment and a transfer on `PersistentBlockProcessor` reduce the sender's native balance by the gas charge from `tests/btcsGasAccounting.test.ts`'s rule. The token balance does not pay that charge.

## 11. What this proposal does not do

- It does not implement the contract.
- It does not change `SimpleERC20`, `BSNA20`, or the asset-service profile union.
- It does not add a SilverForge button that claims BSNA-FTS1 deployment.
- It does not make the token a gas asset.
- It does not define a Solana mint or a BNB deployment.
- It does not authorize production issuance.

## 12. Acceptance for a future implementation change

The implementation is complete only when section 10 passes on Node v24.17.0, `npm run typecheck` passes in the package that owns the tests, and SilverForge labels the option as BSNA-FTS1 on BTCS L2 with BTCS gas. Until that run exists, the status remains **PROPOSAL**.
