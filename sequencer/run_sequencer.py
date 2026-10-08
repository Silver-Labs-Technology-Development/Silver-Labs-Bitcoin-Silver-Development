#!/usr/bin/env python3

import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 5:
    print(f"usage: {sys.argv[0]} <batch-number> <pending-tx-file> <state-file> <output-batch-file>")
    sys.exit(1)

batch_number = sys.argv[1]
pending_file = Path(sys.argv[2])
state_file = Path(sys.argv[3])
output_batch = Path(sys.argv[4])

subprocess.run(
    [sys.executable, "sequencer/build_ordered_batch.py", str(pending_file), str(output_batch)],
    check=True,
)

lines = [
    line
    for line in output_batch.read_text(encoding="utf-8").splitlines()
    if line.strip()
]

tx_files = []

for i, line in enumerate(lines, 1):
    tx_file = output_batch.parent / f"auto-tx-{i}.txt"
    tx_file.write_text(line + "\n", encoding="utf-8")
    tx_files.append(str(tx_file))

state_output = output_batch.parent / f"state-result-{batch_number}.txt"

if state_file.resolve() == state_output.resolve():
    raise ValueError("state input and state output must be different files")

with state_output.open("w", encoding="utf-8") as f:
    subprocess.run(
        [sys.executable, "execution/execute_batch.py", str(state_file), *tx_files],
        stdout=f,
        check=True,
    )

print(f"BATCH={output_batch}")
print(f"TRANSACTIONS={len(tx_files)}")
record_output = output_batch.parent / "batch-exec-record.txt"

with record_output.open("w", encoding="utf-8") as f:
    subprocess.run(
        [sys.executable, "execution/build_batch_record.py", batch_number, str(state_file), *tx_files],
        stdout=f,
        check=True,
    )

print(f"STATE={state_output}")
print(f"RECORD={record_output}")
