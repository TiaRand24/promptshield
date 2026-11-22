# 🛡️ PromptShield

**Client-Side AI Data Loss Prevention (DLP) for ChatGPT, Claude, and Gemini.**

[![CI](https://github.com/TiaRand24/promptshield/actions/workflows/ci.yml/badge.svg)](https://github.com/TiaRand24/promptshield/actions/workflows/ci.yml)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

PromptShield is a **100% local, zero-backend** Chrome Manifest V3 extension that intercepts outgoing prompts in real time, replaces API keys, credentials, and Personally Identifiable Information (PII) with deterministic placeholders (e.g., `[SECRET_1]`, `[EMAIL_1]`), and automatically rehydrates the original values inside the LLM's streamed response in your browser.

Your sensitive data never leaves your machine—and the LLM provider never sees it.

<!-- Replace with your recorded 20-second demo GIF or drag-and-drop MP4 in GitHub -->
<!-- ![PromptShield Demo](docs/demo.gif) -->

---

## Architecture

PromptShield operates entirely inside the browser's execution context with zero external network calls or cloud relay servers:

```mermaid
flowchart LR
    A[User Prompt Input] -->|Capture-Phase Interception| B[Local Regex & Validator Engine]
    B -->|No Secrets Found| E[LLM Web App]
    B -->|Secrets Detected| C[(Ephemeral Session Vault)]
    C -->|Deterministic Tokens| D[Sanitized Prompt Sent]
    D --> E[ChatGPT / Claude / Gemini]
    E -->|Streamed Response with Tokens| F[MutationObserver Rehydrator]
    C -.->|Local Lookup| F
    F -->|DOM-XSS Safe textContent Swap| G[Seamless Rehydrated Output]