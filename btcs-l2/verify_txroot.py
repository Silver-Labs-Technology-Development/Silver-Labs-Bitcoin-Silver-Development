import hashlib

tx1="4337010c861e29ed8227357d17590e7572310e44a95ea8ce653b760397c70751"
tx2="4b2bb79790a1b1cc0488047c9286610199bb7359ebcb6a1931f2dcd79200cdce"
txroot=hashlib.sha256(bytes.fromhex(tx1+tx2)).hexdigest()
expected_txroot="ab83fd2b0125e997e7b0294e08d8baaf196c89853f967c585a1dc35d0ddb4d73"
print("TXROOT:", txroot)
print("TXROOT PASS" if txroot == expected_txroot else "TXROOT FAIL")
