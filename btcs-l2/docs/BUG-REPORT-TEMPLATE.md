# BTCS L2 Alpha — Bug Report Template

**Instructions:** Fill out all applicable sections. Attach logs, screenshots, and steps to reproduce. Incomplete reports may not be triaged.

---

## 📋 Report Header

| Field | Value |
|-------|-------|
| **Title** | [Brief, specific summary] |
| **Severity** | 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low / 🔵 Enhancement |
| **Component** | [EVM / Asset Engine / Asset Service / Studio / L1 Integration / Docs] |
| **Reported By** | [Name/Handle] |
| **Date** | [YYYY-MM-DD] |
| **Commit** | `git rev-parse HEAD` output |
| **Branch** | `git branch --show-current` |

---

## 🐛 Bug Description

### What happened?
[Clear description of the incorrect behavior]

### What did you expect?
[Clear description of the correct behavior]

---

## 🔁 Steps to Reproduce

1. [Step 1: e.g., "Start L2 RPC with `--dev-sequencer`"]
2. [Step 2: e.g., "Open Studio at http://localhost:5173"]
3. [Step 3: e.g., "Go to Token Studio → ERC-20 tab"]
4. [Step 4: e.g., "Fill form: Name=Test, Symbol=TEST, Decimals=18, Supply=1000000"]
5. [Step 5: e.g., "Click 'Estimate Fees'"]
6. [Step 6: e.g., "Click 'Deploy Token'"]
7. [Observe: e.g., "Error toast appears: 'Deployment failed: ...'"]

---

## 🖥️ Environment

| Item | Value |
|------|-------|
| **OS** | [e.g., Ubuntu 22.04, macOS 14, Windows 11] |
| **Node.js** | `node --version` output |
| **npm** | `npm --version` output |
| **bitcoinsilverd** | Version/commit (if L1 used) |
| **Services Running** | ☐ L1 Regtest ☐ L2 RPC ☐ Asset Service ☐ Studio Dev |
| **Network** | ☐ Local BTCS L2 only ☐ Sepolia ☐ BNB Testnet |

---

## 📎 Evidence

### Logs
```
[Paste relevant terminal output, service logs, or browser console errors here]
```

### Screenshots
[Attach or describe screenshots of the UI state]

### API Responses
```json
{
  "Paste relevant API request/response here"
}
```

---

## 🔍 Additional Context

### Configuration
```bash
# Relevant environment variables (redact secrets)
ASSET_STORAGE_PROVIDER=local-dev
ASSET_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
BTCS_L2_RPC_URL=http://127.0.0.1:8545
# ... others
```

### Recent Changes
- [ ] Fresh install
- [ ] Updated from previous commit
- [ ] Modified configuration
- [ ] Reset test data (`rm -rf /tmp/btcs-l2-test-data` etc.)

### Workarounds Tried
[What you've already attempted to fix/work around the issue]

---

## ✅ Acceptance Criteria for Fix

[What would verify the bug is fixed? e.g., "Deploy succeeds and receipt modal shows correct gas used"]

---

## 🏷️ Labels (for triage)

- [ ] `bug`
- [ ] `regression`
- [ ] `ui`
- [ ] `backend`
- [ ] `security`
- [ ] `documentation`
- [ ] `blocked` (waiting on decision/dependency)
- [ ] `alpha-blocker` (prevents alpha workflow)

---

## 📝 For Maintainers

| Field | Value |
|-------|-------|
| **Assigned** | [Maintainer] |
| **Milestone** | [Alpha / Post-Alpha / Backlog] |
| **Related Tasks** | [WORK-QUEUE.md task IDs] |
| **Related Issues** | [Links] |

---

**Thank you for reporting!** Clear, reproducible reports help us ship a better alpha.