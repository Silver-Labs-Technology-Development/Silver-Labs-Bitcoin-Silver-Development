#!/usr/bin/env python3
"""Verify one or more v0.9 envelopes from an explicitly selected profile."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .v09_protocol import (
    ProtocolError,
    available_profiles,
    verify_profile_history,
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
        "envelopes",
        nargs="+",
        type=Path,
        help="v0.9 envelope files in consecutive batch order",
    )
    args = parser.parse_args()

    try:
        envelope_bytes = [path.read_bytes() for path in args.envelopes]
        profile, _state, _next_batch, results = verify_profile_history(
            envelope_bytes,
            args.profile,
        )
        for result in results:
            print(
                f"BATCH {result.batch_number} PASS "
                f"chain={profile.chain_id} state={result.fields['state']} "
                f"batch_hash={result.fields['batch_hash']}"
            )
    except (OSError, ProtocolError) as exc:
        print(f"VERIFICATION FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
