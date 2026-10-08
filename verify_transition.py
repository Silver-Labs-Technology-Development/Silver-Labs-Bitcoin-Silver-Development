import hashlib

prev="0000000000000000000000000000000000000000000000000000000000000000"
txroot="ab83fd2b0125e997e7b0294e08d8baaf196c89853f967c585a1dc35d0ddb4d73"
commitment=hashlib.sha256(bytes.fromhex(prev+txroot)).hexdigest()
expected="aa390634c9aaa562c03d009c51afa7dc2f90ce45b575b82684915234863ceed9"
print("TRANSITION:", commitment)
print("TRANSITION PASS" if commitment == expected else "TRANSITION FAIL")
