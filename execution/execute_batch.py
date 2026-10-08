import sys

state_file = sys.argv[1]
tx_files = sys.argv[2:]

state = {}

for line in open(state_file):
    name, balance = line.strip().split("=")
    state[name] = int(balance)

for tx_file in tx_files:
    line = open(tx_file).read().strip()
    parts = line.split("|")

    sender = parts[3].split("=")[1]
    receiver = parts[4].split("=")[1]
    amount = int(parts[5].split("=")[1])

    if sender not in state or receiver not in state:
        raise ValueError("unknown account")

    if amount <= 0:
        raise ValueError("invalid amount")

    if state[sender] < amount:
        raise ValueError("insufficient balance")

    state[sender] -= amount
    state[receiver] += amount

for name in sorted(state):
    print(f"{name}={state[name]}")
