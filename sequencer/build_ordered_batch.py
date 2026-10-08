#!/usr/bin/env python3

import sys

if len(sys.argv) != 3:
    print(f"usage: {sys.argv[0]} <pending-tx-file> <output-file>")
    sys.exit(1)

pending_file = sys.argv[1]
output_file = sys.argv[2]

transactions = []

with open(pending_file, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue

        parts = line.split("|")
        fields = {}

        for part in parts[2:]:
            key, value = part.split("=", 1)
            fields[key] = value

        transactions.append((int(fields["id"]), line))

transactions.sort(key=lambda item: item[0])

with open(output_file, "w", encoding="utf-8") as f:
    for _, transaction in transactions:
        f.write(transaction + "\n")
