import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PromptInterceptor } from '../src/content/interceptor';

describe('Phase 4: End-to-End Test Harness Verification', () => {
  let activeInterceptor: PromptInterceptor | null = null;

  beforeEach(() => {
    // Load test-harness HTML
    const harnessPath = resolve(__dirname, '../test-harness.html');
    const html = readFileSync(harnessPath, 'utf-8');
    document.documentElement.innerHTML = html;

    // Execute test-harness scripts
    const scripts = document.querySelectorAll('script');
    scripts.forEach((script) => {
      if (script.textContent) {
        // Evaluate the inline script to bind React and ProseMirror harness listeners
        new Function(script.textContent)();
      }
    });
  });

  afterEach(() => {
    activeInterceptor?.destroy();
    activeInterceptor = null;
  });

  it('sanitizes React-controlled textarea containing OpenAI key, email, and Luhn credit card on submit', async () => {
    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const textarea = document.getElementById('prompt-textarea') as HTMLTextAreaElement;
    const sendButton = document.getElementById('send-button') as HTMLButtonElement;

    // Prompt containing:
    // 1. OpenAI key: sk-proj-1234567890abcdef1234567890abcdef
    // 2. Email: alice.dev@company.com
    // 3. Valid Luhn CC: 4532 0151 1283 0366
    const sensitivePrompt =
      'Please analyze this secret: sk-proj-1234567890abcdef1234567890abcdef for user alice.dev@company.com with card 4532 0151 1283 0366';

    // Simulate user typing in React textarea
    textarea.value = sensitivePrompt;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));

    // Verify React internal state captured the initial input
    const stateDisplay = document.getElementById('react-state-display')!;
    expect(stateDisplay.textContent).toContain('sk-proj-1234567890abcdef');

    // Click submit button to trigger interception & sanitization
    sendButton.click();

    // Wait for microtask tick and safe submit dispatch
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Inspect submitted payload received by the host framework
    const lastPayload = (window as unknown as { __lastSubmittedPayload?: string }).__lastSubmittedPayload;
    expect(lastPayload).toBeDefined();

    // Verification: MUST contain tokens
    expect(lastPayload).toContain('[SECRET_1]');
    expect(lastPayload).toContain('[EMAIL_1]');
    expect(lastPayload).toContain('[CREDIT_CARD_1]');

    // Verification: MUST NOT contain any sensitive raw values
    expect(lastPayload).not.toContain('sk-proj-1234567890abcdef');
    expect(lastPayload).not.toContain('alice.dev@company.com');
    expect(lastPayload).not.toContain('4532 0151 1283 0366');

    // Verify exact expected structure
    expect(lastPayload).toBe(
      'Please analyze this secret: [SECRET_1] for user [EMAIL_1] with card [CREDIT_CARD_1]'
    );
  });

  it('sanitizes ProseMirror contenteditable editor containing secrets', async () => {
    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const editor = document.getElementById('prosemirror-editor') as HTMLDivElement;
    const pmSendBtn = document.getElementById('prosemirror-send-button') as HTMLButtonElement;

    const sensitivePrompt =
      'Server IP is 198.51.100.99 and key is AKIAIOSFODNN7EXAMPLE';

    editor.textContent = sensitivePrompt;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));

    // Intercept ProseMirror submission
    pmSendBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 150));

    const lastPayload = (window as unknown as { __lastSubmittedPayload?: string }).__lastSubmittedPayload;
    expect(lastPayload).toBeDefined();

    expect(lastPayload).toContain('[IP_1]');
    expect(lastPayload).toContain('[SECRET_1]');
    expect(lastPayload).not.toContain('198.51.100.99');
    expect(lastPayload).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });
});
