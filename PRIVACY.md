# Privacy Policy for PromptShield

**Effective Date:** November 2026  
**Repository:** [https://github.com/TiaRand24/promptshield](https://github.com/TiaRand24/promptshield)

PromptShield is built from the ground up with a strict **zero-data-collection, zero-telemetry, 100% client-side** security architecture.

---

## 1. Zero Data Collection & Zero Remote Calls

- **No Remote Servers:** PromptShield makes zero external network requests. There are no backend APIs, analytics trackers, telemetry collectors, or crash-reporting endpoints.
- **Local Interception:** All regex evaluation, checksum validations (such as Luhn algorithm checks), token generation, and DOM rehydration execute entirely inside your local browser instance.
- **Content Security Policy:** The extension enforces `connect-src 'self'` via Manifest V3, strictly disallowing any third-party network egress.

---

## 2. In-Memory & Local Session Storage

- **Ephemeral Session Vault:** When sensitive credentials or PII are tokenized, mappings between original secrets and placeholder tokens (e.g., `[SECRET_1]`) are retained solely in browser session memory (`chrome.storage.session`).
- **No Disk or Persistent Logging:** Token mappings are automatically wiped when your browser session ends, or immediately when you click **Clear Session Vault** in the extension popup.
- **Custom Dictionary:** User-defined blacklist keywords configured in the extension popup are saved locally on your device via `chrome.storage.local` and never transmitted across the network.

---

## 3. Chrome Permissions

PromptShield requests only the minimal permissions required to sanitize prompts:
- `storage`: Required strictly for session-scoped in-memory vault mappings and local user preference storage.
- `offscreen`: Reserved for sandboxed, client-side processing without DOM access.
- `host_permissions`: Explicitly scoped only to supported AI chat interfaces (`https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*`, and local test harnesses). We never request broad access such as `<all_urls>`.

---

## 4. Third-Party Services & Links

- PromptShield contains zero third-party software development kits (SDKs) and zero tracking libraries.
- The optional **Report broken selector** link in the popup opens GitHub's standard new issue form in a new tab (`https://github.com/TiaRand24/promptshield/issues/new`) using pre-filled URL query parameters, so you can report site DOM changes without automated telemetry.

---

## 5. Contact & Open Source Verification

PromptShield is open-source software. You are encouraged to inspect the full source code and verify our network-free guarantees directly on GitHub:  
[https://github.com/TiaRand24/promptshield](https://github.com/TiaRand24/promptshield)
