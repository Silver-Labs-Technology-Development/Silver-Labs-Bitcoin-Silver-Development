import hashlib
import sys

batch_number = sys.argv[1]
state_file = sys.argv[2]
tx_files = sys.argv[3:]

ZERO = "0" * 64

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()

prev_state = sha256_file(state_file)
tx_hashes = [sha256_file(path) for path in tx_files]

tx_data = b"".join(bytes.fromhex(h) for h in tx_hashes)
txroot = hashlib.sha256(tx_data).hexdigest()

state = {}
for line in open(state_file):
    name, balance = line.strip().split("=")
    state[name] = int(balance)

for tx_file in tx_files:
    parts = open(tx_file).read().strip().split("|")
    sender = parts[3].split("=")[1]
    receiver = parts[4].split("=")[1]
    amount = int(parts[5].split("=")[1])
    state[sender] -= amount
    state[receiver] += amount

result = "".join(f"{name}={state[name]}\n" for name in sorted(state))
state_root = hashlib.sha256(result.encode()).hexdigest()

transition = hashlib.sha256(
    bytes.fromhex(prev_state) + bytes.fromhex(txroot)
).hexdigest()

canonical = (
    f"BTCSL2BATCH|v0.6|batch={batch_number}|"
    f"prev={prev_state}|"
    f"txroot={txroot}|"
    f"state={state_root}|"
    f"transition={transition}"
)

batch_hash = hashlib.sha256(canonical.encode()).hexdigest()

print(f"PREVSTATE={prev_state}")
print(f"TXROOT={txroot}")
print(f"STATE={state_root}")
print(f"TRANSITION={transition}")
print(f"BATCH={batch_hash}")
