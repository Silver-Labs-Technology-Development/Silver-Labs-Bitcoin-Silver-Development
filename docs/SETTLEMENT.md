# BTCS L2 Settlement Specification

**Status:** Research / Prototype
**Version:** 0.1
**Project:** Silver Labs BTCS L2
## 1. Purpose
This document defines the initial settlement model for the BTCS Layer 2 prototype.
The goal is to allow an independent L2 execution environment to periodically commit its state to the BTCS Layer 1 blockchain without requiring changes to BTCS Layer 1 consensus.
This is a research specification, not a production protocol.
## 2. Architecture
L2 Transactions -> L2 Execution -> State Transition -> L2 Batch -> State Commitment -> Settlement Transaction -> BTCS Layer 1
BTCS Layer 1 remains the settlement and finality layer.
The L2 handles execution, ordering, and L2 state.
## 3. L2 Batch
An L2 batch represents an ordered group of L2 transactions executed against a specific previous L2 state.
Each batch MUST contain, at minimum:
- L2 chain identifier
- Batch number
- Previous state commitment
- New state commitment
- Transaction commitment
- Batch metadata
- Settlement commitment identifier
The batch links one deterministic L2 state to the next.
## 4. State Commitment
The L2 state MUST be represented by a deterministic cryptographic commitment.
The initial prototype will use a Merkle-based commitment unless research determines that another authenticated data structure is more appropriate.
The commitment MUST allow independent software to determine whether a claimed L2 state belongs to the committed L2 history.

## 5. Transaction Commitment

L2 transactions SHOULD be represented by a deterministic transaction commitment.

The initial prototype will use a Merkle root to commit to the ordered transactions contained in an L2 batch.

The transaction commitment MUST preserve transaction ordering.

Conceptually:

Transaction 1
      |
Transaction 2
      |
Transaction 3  ->  Merkle Root
      |
Transaction N

## 6. Settlement Commitment

The settlement commitment combines the information necessary to identify an L2 state transition.

The initial conceptual structure is:

- L2 chain identifier
- Batch number
- Previous state root
- New state root
- Transaction root

These values will be serialized deterministically and hashed to produce the settlement commitment.

Conceptually:

H(chain_id || batch_number || previous_state_root || new_state_root || transaction_root) = settlement_commitment

## 7. BTCS Settlement Transaction

The initial prototype will investigate publishing the settlement commitment through a BTCS transaction using an OP_RETURN data carrier.

The OP_RETURN payload MUST contain only the minimum information necessary to identify the settlement commitment.

The prototype MUST NOT assume that OP_RETURN itself provides L2 validity or fraud protection.

OP_RETURN is treated as a Layer 1 publication and anchoring mechanism.

## 8. Settlement Identification

A settlement transaction MUST be uniquely associated with:

- BTCS transaction ID
- L2 chain identifier
- L2 batch number
- Settlement commitment

The L2 settlement indexer will monitor BTCS and record confirmed settlements.

Conceptually:

BTCS Transaction -> Settlement Decoder -> L2 Settlement Index -> Confirmed Batch

## 9. Confirmation

A settlement MUST NOT be considered finalized immediately after broadcast.

The prototype will define a configurable BTCS confirmation threshold.

Example:

Broadcast -> BTCS mempool -> BTCS block -> N confirmations -> L2 settlement considered confirmed

The exact production confirmation policy remains TBD.

## 10. Sequencer

The initial prototype may use a centralized sequencer for simplicity.

The sequencer:

1. Receives L2 transactions.
2. Orders transactions.
3. Executes the batch.
4. Produces the resulting state commitment.
5. Produces the transaction commitment.
6. Creates the settlement commitment.
7. Publishes the settlement transaction to BTCS.

Sequencer decentralization is a future protocol requirement.

## 11. Independent Verification

The L2 MUST be designed so that an independent node can reconstruct and verify the L2 state from:

- L2 transaction history
- Previous state commitments
- Batch commitments
- BTCS settlement records

The goal is to avoid requiring trust in the sequencer merely to determine the historical L2 state.

## 12. Failure Cases

### Sequencer failure

The sequencer stops producing batches.

The L2 state remains at the last confirmed or accepted batch.

### Invalid batch

A batch produces a state commitment that cannot be reproduced from the published L2 transaction history.

The batch MUST be considered invalid by an independent verifier.

### Missing settlement

An L2 batch exists locally but has no corresponding BTCS settlement.

The batch MUST NOT be treated as L1-settled.

### Conflicting settlement

Two different commitments claim the same L2 batch number.

The protocol MUST define deterministic conflict handling.

## 13. Data Availability

Publishing only a state commitment does not automatically provide data availability.

The prototype MUST separately investigate where complete L2 transaction data is stored and how an independent node can retrieve it.

Possible future approaches include:

- L2 node-to-node replication
- Archival storage
- Decentralized data availability
- BTCS transaction data
- Additional settlement layers

No final approach is selected in v0.1.

## 14. Proof System

The prototype does NOT yet claim to be a validity-proof or ZK rollup.

Proof architecture remains TBD.

Future research may investigate:

- Fraud proofs
- Validity proofs
- ZK proofs
- Deterministic execution proofs
- Optimistic rollup mechanisms

## 15. Layer 1 Changes

The primary goal of the prototype is to operate without modifying BTCS L1 consensus rules.

The L2 SHOULD use existing BTCS transaction, block, and RPC functionality wherever practical.

Any proposed BTCS consensus modification MUST be documented separately and independently justified.

The prototype MUST NOT assume that L1 consensus changes are required merely to implement L2 execution or settlement.

## 16. Prototype Components

The initial prototype is organized into the following components:

btcs-l2/
├── execution/
├── sequencer/
├── state/
├── settlement/
├── rpc/
├── contracts/
├── tests/
└── docs/

The settlement component is expected to eventually contain:

settlement/
├── commitment
├── encoder
├── decoder
├── btcs_client
└── verifier

Exact implementation languages, libraries, and dependencies remain open until component research and testing are complete.

## 17. Prototype Milestones

### Phase 1 — Specification

- Define L2 batch structure.
- Define state commitment.
- Define transaction commitment.
- Define settlement commitment.

### Phase 2 — Local BTCS Testing

- Run an isolated BTCS regtest network.
- Produce controlled BTCS blocks.
- Create experimental settlement transactions.
- Read settlement data through BTCS RPC.

### Phase 3 — L2 Prototype

- Implement deterministic L2 state.
- Implement batch execution.
- Generate commitments.
- Implement settlement encoding.
- Implement a BTCS settlement watcher.

### Phase 4 — Verification

- Reconstruct L2 state independently.
- Verify commitments.
- Verify BTCS settlement history.
- Test failure cases.

### Phase 5 — Advanced Rollup Research

- Investigate data availability.
- Investigate fraud proofs.
- Investigate validity proofs.
- Investigate ZK systems.
- Investigate sequencer decentralization.

## 18. Current Status

This document describes a research and prototype architecture, not a production protocol.

Implementation details may change as proven open-source components are researched, integrated, and tested against BTCS.

Major architectural changes MUST be recorded in a subsequent specification version.

The next implementation target is an isolated BTCS regtest settlement experiment.
