import hashlib

record = {}
for line in open("execution/batch-1-record.txt"):
    key, value = line.strip().split("=", 1)
    record[key] = value

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()

expected_prev = sha256_file("execution/state-0.txt")
tx_hashes = [
    sha256_file("execution/tx-1.txt"),
    sha256_file("execution/tx-2.txt")
]

expected_txroot = hashlib.sha256(
    b"".join(bytes.fromhex(h) for h in tx_hashes)
).hexdigest()

expected_state = sha256_file("execution/state-2.txt")

expected_transition = hashlib.sha256(
    bytes.fromhex(expected_prev) + bytes.fromhex(expected_txroot)
).hexdigest()

canonical = (
    f"BTCSL2BATCH|v0.6|batch=1|"
    f"prev={expected_prev}|"
    f"txroot={expected_txroot}|"
    f"state={expected_state}|"
    f"transition={expected_transition}"
)

expected_batch = hashlib.sha256(canonical.encode()).hexdigest()

checks = [
    ("PREVSTATE", expected_prev),
    ("TXROOT", expected_txroot),
    ("STATE", expected_state),
    ("TRANSITION", expected_transition),
    ("BATCH", expected_batch),
]

for name, expected in checks:
    actual = record.get(name)
    status = "PASS" if actual == expected else "FAIL"
    print(f"{name}: {status}")
    if status == "FAIL":
        print(f"  expected={expected}")
        print(f"  actual  ={actual}")

if all(record.get(name) == expected for name, expected in checks):
    print("BATCH RECORD END-TO-END PASS")
else:
    raise SystemExit(1)
