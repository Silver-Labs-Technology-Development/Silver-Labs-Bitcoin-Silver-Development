#!/usr/bin/env python3
"""Build a canonical v0.9 envelope from LF-terminated v0.7 transactions.

Example:
    python -m settlement.v09.build_ordered_batch \
        --profile clean-genesis \
        --transactions settlement/v09/clean-recovery/batch-1-data.txt

For later v0.9 batches, pass previously verified envelopes in order with
--history. The selected profile, not an envelope field, fixes activation.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .v09_protocol import (
    ProtocolError,
    available_profiles,
    build_for_profile,
)


def main() -> int:
    try:
        profiles = available_profiles()
    except ProtocolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, choices=profiles)
    parser.add_argument(
        "--transactions",
        required=True,
        type=Path,
        help="LF-terminated BTCSL2TX|v0.7 records; the builder sorts by unique numeric ID",
    )
    parser.add_argument(
        "--history",
        nargs="*",
        type=Path,
        default=(),
        help="prior v0.9 envelopes in order, starting at the selected activation batch",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="write the one-line envelope here; otherwise write exact bytes to stdout",
    )
    args = parser.parse_args()

    try:
        transaction_data = args.transactions.read_bytes()
        history = [path.read_bytes() for path in args.history]
        result = build_for_profile(
            transaction_data,
            args.profile,
            history=history,
        )
        if args.output:
            args.output.write_bytes(result.envelope)
        else:
            sys.stdout.buffer.write(result.envelope)
    except (OSError, ProtocolError) as exc:
        print(f"BUILD FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
