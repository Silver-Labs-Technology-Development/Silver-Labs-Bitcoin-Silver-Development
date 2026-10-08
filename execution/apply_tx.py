state={}
for line in open("execution/state-0.txt"):
    name,balance=line.strip().split("=")
    state[name]=int(balance)
line=open("execution/tx-1.txt").read().strip()
parts=line.split("|")
sender=parts[3].split("=")[1]
receiver=parts[4].split("=")[1]
amount=int(parts[5].split("=")[1])
if state[sender] < amount:
    raise ValueError("insufficient balance")
state[sender]-=amount
state[receiver]+=amount
with open("execution/state-1.txt","w") as f:
    for name in ["alice","bob","carol"]:
        f.write(f"{name}={state[name]}\n")
print(open("execution/state-1.txt").read(), end="")
