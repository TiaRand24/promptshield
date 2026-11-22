# Security Policy

## Architecture Security Guarantees

PromptShield is built around minimizing the browser extension trust boundary:

1. **Zero Backend / Zero Network Egress:** All regex matching, Luhn validation, tokenization, and rehydration execute locally. There is no remote server that can be breached or subpoenaed for user secrets.
2. **Manifest V3 Compliance:** Zero remotely hosted code, zero `eval()`, and strict Content Security Policy adherence (no inline event handlers).
3. **DOM-XSS Safe Rehydration:** Original secret values are re-inserted into LLM responses strictly via `textContent` on newly created `<span>` elements—never via `innerHTML`—preventing crafted LLM outputs or secret strings from injecting executable markup.
4. **Shadow DOM UI Isolation:** The auto-sanitized Undo pill and Review diff modal render inside a Shadow DOM root, with all displayed diff text explicitly HTML-escaped.
5. **Explicit Memory Wipe:** Triggering `CLEAR_VAULT` resets both the session vault maps and the content-script rehydrator's in-memory `vaultMap`.

## Supported Versions

Only the latest published release on the Chrome Web Store and `main` branch is actively maintained for security fixes.

## Reporting a Vulnerability

If you discover a security vulnerability, regex bypass, or DOM-XSS issue in PromptShield:

* **Please do not** open a public GitHub issue containing exploit details.
* Use GitHub's **Private Vulnerability Reporting** feature under the **Security** tab of this repository ("Report a vulnerability").
* Include reproduction steps, the target LLM site (if applicable), and any sample non-sensitive test strings.