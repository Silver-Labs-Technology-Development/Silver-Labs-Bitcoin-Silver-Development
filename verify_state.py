import hashlib

data=open("state-1.txt","rb").read()
state=hashlib.sha256(data).hexdigest()
expected="2bfbd299e2f59ac23beb293597c63a6d4e358f0ce17e633a1e69a2e4da4c63d2"
print("STATE:", state)
print("STATE PASS" if state == expected else "STATE FAIL")
