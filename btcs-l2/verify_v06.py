import hashlib

data=open("batch-1-canonical.txt","rb").read()
actual=hashlib.sha256(data).hexdigest()
expected="1ce3ca657f09e08f5ab5e722ddb20631d87464b96521adae960143de3d69213e"
print("EXPECTED:", expected)
print("ACTUAL:  ", actual)
print("PASS" if actual == expected else "FAIL")
