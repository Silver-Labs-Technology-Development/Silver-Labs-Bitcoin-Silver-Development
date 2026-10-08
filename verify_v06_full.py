import hashlib

tx1="4337010c861e29ed8227357d17590e7572310e44a95ea8ce653b760397c70751"
tx2="4b2bb79790a1b1cc0488047c9286610199bb7359ebcb6a1931f2dcd79200cdce"
txroot=hashlib.sha256(bytes.fromhex(tx1+tx2)).hexdigest()
state=hashlib.sha256(open("state-1.txt","rb").read()).hexdigest()
prev="0000000000000000000000000000000000000000000000000000000000000000"
transition=hashlib.sha256(bytes.fromhex(prev+txroot)).hexdigest()
batch=f"BTCSL2BATCH|v0.6|batch=1|prev={prev}|txroot={txroot}|state={state}|transition={transition}\n"
batch_hash=hashlib.sha256(batch.encode()).hexdigest()
print("TXROOT:", txroot)
print("STATE:", state)
print("TRANSITION:", transition)
print("BATCH:", batch_hash)
print("V0.6 END-TO-END PASS" if batch_hash=="1ce3ca657f09e08f5ab5e722ddb20631d87464b96521adae960143de3d69213e" else "V0.6 END-TO-END FAIL")
