import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatGPTAdapter, ClaudeAdapter } from '../src/content/dom-adapters';
import { PromptInterceptor } from '../src/content/interceptor';
import { ResponseRehydrator } from '../src/content/rehydrator';
import { UIOverlay } from '../src/content/ui-overlay';

describe('DOM Adapters & React/ProseMirror State Mutation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('updates React controlled textarea via native setter and dispatches InputEvent', () => {
    const textarea = document.createElement('textarea');
    textarea.id = 'prompt-textarea';
    document.body.appendChild(textarea);

    let inputEventFired = false;
    let receivedData = '';

    textarea.addEventListener('input', (e) => {
      inputEventFired = true;
      if (e instanceof InputEvent) {
        receivedData = e.data || '';
      }
    });

    const success = ChatGPTAdapter.setPromptText(textarea, 'Sanitized [EMAIL_1]');
    expect(success).toBe(true);
    expect(textarea.value).toBe('Sanitized [EMAIL_1]');
    expect(inputEventFired).toBe(true);
    expect(receivedData).toBe('Sanitized [EMAIL_1]');
  });

  it('updates ChatGPT contenteditable div wrapping <p> nodes and dispatches InputEvent', () => {
    const editor = document.createElement('div');
    editor.id = 'prompt-textarea';
    editor.contentEditable = 'true';
    editor.className = 'ProseMirror';
    const p = document.createElement('p');
    p.textContent = 'Secret AKIAIOSFODNN7EXAMPLE';
    editor.appendChild(p);
    document.body.appendChild(editor);

    // Verify getPromptText reads from <p> correctly
    const promptText = ChatGPTAdapter.getPromptText(editor);
    expect(promptText).toBe('Secret AKIAIOSFODNN7EXAMPLE');

    let inputFired = false;
    editor.addEventListener('input', () => {
      inputFired = true;
    });

    const success = ChatGPTAdapter.setPromptText(editor, 'Secret [SECRET_1]');
    expect(success).toBe(true);
    expect(editor.textContent).toContain('Secret [SECRET_1]');
    expect(inputFired).toBe(true);
  });

  it('updates ProseMirror contenteditable div and dispatches InputEvent', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.className = 'ProseMirror';
    const p = document.createElement('p');
    p.textContent = 'Old text';
    editor.appendChild(p);
    document.body.appendChild(editor);

    let inputFired = false;
    editor.addEventListener('input', () => {
      inputFired = true;
    });

    const success = ClaudeAdapter.setPromptText(editor, 'Sanitized [SECRET_1]');
    expect(success).toBe(true);
    expect(editor.textContent).toContain('Sanitized [SECRET_1]');
    expect(inputFired).toBe(true);
  });
});

describe('PromptInterceptor Capture-Phase and Anti-Looping', () => {
  let activeInterceptor: PromptInterceptor | null = null;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="chat-container">
        <textarea id="prompt-textarea"></textarea>
        <button id="send-button" type="submit">Send</button>
      </div>
    `;
  });

  afterEach(() => {
    activeInterceptor?.destroy();
    activeInterceptor = null;
  });

  it('halts raw submission on Enter when sensitive entity is present and updates text', () => {
    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const textarea = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    textarea.value = 'My key is sk-proj-1234567890abcdef1234567890abcdef please analyze';

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    textarea.dispatchEvent(enterEvent);

    // Event should have been stopped
    expect(enterEvent.defaultPrevented).toBe(true);
    // Input element should now contain tokenized prompt
    expect(textarea.value).toContain('[SECRET_1]');
    expect(textarea.value).not.toContain('sk-proj-1234567890abcdef');
  });

  it('does NOT intercept when no sensitive entities are in prompt', () => {
    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const textarea = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    textarea.value = 'Hello AI, how is the weather today?';

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    textarea.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(false);
  });

  it('prevents infinite recursion via synthetic bypass tag', () => {
    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const textarea = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    textarea.value = 'Secret: sk-proj-1234567890abcdef1234567890abcdef';

    // Dispatched with bypass flag
    const bypassEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    (bypassEvent as unknown as { __isPromptShieldBypass: boolean }).__isPromptShieldBypass = true;

    textarea.dispatchEvent(bypassEvent);
    // Should NOT be prevented because it's tagged as bypass
    expect(bypassEvent.defaultPrevented).toBe(false);
  });

  it('halts click submission on send button and tokenizes input', () => {
    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const textarea = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    textarea.value = 'Deploy to 198.51.100.25';

    const sendBtn = document.querySelector('#send-button') as HTMLButtonElement;

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    sendBtn.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('Deploy to [IP_1]');
  });

  it('halts click submission on ChatGPT data-testid send-button with contenteditable div', () => {
    document.body.innerHTML = `
      <form>
        <div id="prompt-textarea" contenteditable="true" class="ProseMirror">
          <p>My key is AKIAIOSFODNN7EXAMPLE</p>
        </div>
        <button data-testid="fruitjuice-send-button" type="button">Send</button>
      </form>
    `;

    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const editor = document.querySelector('#prompt-textarea') as HTMLDivElement;
    const sendBtn = document.querySelector('button[data-testid="fruitjuice-send-button"]') as HTMLButtonElement;

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    sendBtn.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(editor.textContent).toContain('[SECRET_1]');
    expect(editor.textContent).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('Layer 1: Intercepts paste events on contenteditable in capture phase and immediately sanitizes secrets', () => {
    document.body.innerHTML = `
      <div id="prompt-textarea" contenteditable="true" class="ProseMirror">
        <p></p>
      </div>
    `;

    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const editor = document.querySelector('#prompt-textarea') as HTMLDivElement;

    // Simulate clipboard data transfer
    const mockClipboard = {
      getData: (format: string) => {
        if (format === 'text/plain') {
          return 'Here is my OpenAI key: sk-proj-1234567890abcdef1234567890abcdef and test@company.com';
        }
        return '';
      },
    };

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: mockClipboard,
      writable: false,
    });

    editor.dispatchEvent(pasteEvent);

    // Event must be halted in capture phase
    expect(pasteEvent.defaultPrevented).toBe(true);

    // Vault should have registered the entities
    const vaultState = activeInterceptor.getVault().exportState();
    expect(Object.keys(vaultState.tokenToOriginal).length).toBe(2);
    expect(vaultState.tokenToOriginal['[SECRET_1]']).toBe('sk-proj-1234567890abcdef1234567890abcdef');
    expect(vaultState.tokenToOriginal['[EMAIL_1]']).toBe('test@company.com');

    // DOM should contain ONLY sanitized tokens, NEVER raw secrets
    expect(editor.textContent).not.toContain('sk-proj-1234567890abcdef');
    expect(editor.textContent).not.toContain('test@company.com');
  });

  it('Layer 3: Intercepts pointerdown on send button before click can fire', () => {
    document.body.innerHTML = `
      <form>
        <div id="prompt-textarea" contenteditable="true" class="ProseMirror">
          <p>Deploy AWS token AKIAIOSFODNN7EXAMPLE</p>
        </div>
        <button data-testid="send-button" type="button">Send</button>
      </form>
    `;

    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const editor = document.querySelector('#prompt-textarea') as HTMLDivElement;
    const sendBtn = document.querySelector('button[data-testid="send-button"]') as HTMLButtonElement;

    // Send button receives pointerdown first in user interaction
    const pointerDownEvent = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });

    sendBtn.dispatchEvent(pointerDownEvent);

    // pointerdown must be halted immediately so host framework cannot trigger early submit
    expect(pointerDownEvent.defaultPrevented).toBe(true);
    expect(editor.textContent).toContain('[SECRET_1]');
    expect(editor.textContent).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('triggers debounced input sanitizer on typed email and replaces it in-place before submit', async () => {
    document.body.innerHTML = `
      <form>
        <textarea id="prompt-textarea"></textarea>
        <button id="send-button" type="submit">Send</button>
      </form>
    `;

    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const textarea = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    textarea.value = 'Please contact dev@acme.io for support';

    // Dispatch input event simulating typing
    const inputEv = new InputEvent('input', { bubbles: true, cancelable: true });
    textarea.dispatchEvent(inputEv);

    // Wait for the 300ms debounce timer to fire
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(textarea.value).toContain('[EMAIL_1]');
    expect(textarea.value).not.toContain('dev@acme.io');

    const vaultState = activeInterceptor.getVault().exportState();
    expect(vaultState.tokenToOriginal['[EMAIL_1]']).toBe('dev@acme.io');
  });

  it('immediately triggers in-place sanitizer when typing whitespace after a secret', () => {
    document.body.innerHTML = `
      <form>
        <textarea id="prompt-textarea"></textarea>
        <button id="send-button" type="submit">Send</button>
      </form>
    `;

    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const textarea = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    textarea.value = 'Contact dev@acme.io ';

    // Dispatch immediate input event (space character typed)
    const spaceInput = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: ' ',
    });
    textarea.dispatchEvent(spaceInput);

    // Replaced synchronously without waiting 300ms
    expect(textarea.value).toContain('[EMAIL_1]');
    expect(textarea.value).not.toContain('dev@acme.io');
  });

  it('Regression Test: does not throw when initialized at document_start (document.body is null)', () => {
    const originalBody = document.body;
    try {
      // Simulate document_start DOM state where document.body is not yet parsed
      Object.defineProperty(document, 'body', {
        value: null,
        configurable: true,
        writable: true,
      });

      expect(document.body).toBeNull();
      expect(document.documentElement).not.toBeNull();

      // Instantiating PromptInterceptor at document_start must not throw TypeError: Cannot read properties of null
      let interceptor: PromptInterceptor | null = null;
      expect(() => {
        interceptor = new PromptInterceptor();
        interceptor.attachEventListeners();
      }).not.toThrow();

      // UIOverlay.show() must gracefully fall back to documentElement without crashing
      const overlay = new UIOverlay();
      expect(() => {
        overlay.show(1);
      }).not.toThrow();

      const host = document.getElementById('prompt-shield-overlay-root');
      expect(host).not.toBeNull();
      expect(document.documentElement.contains(host)).toBe(true);

      host?.remove();
      (interceptor as PromptInterceptor | null)?.destroy();
    } finally {
      // Restore document.body
      Object.defineProperty(document, 'body', {
        value: originalBody,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe('ResponseRehydrator: Streaming DOM Token Restoration', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="chat-transcript">
        <div class="message" id="msg-1">Waiting...</div>
      </div>
    `;
  });

  it('replaces token text node with rehydrated styled span without infinite loops', () => {
    const vaultMap = {
      '[SECRET_1]': 'sk-proj-test-secret-value-123',
    };

    const rehydrator = new ResponseRehydrator(vaultMap, true);
    const msg = document.getElementById('msg-1')!;

    // Directly test scanAndRehydrateTextNode
    msg.textContent = 'Here is your sanitized secret: [SECRET_1]. Do not share it.';
    const textNode = msg.firstChild as Text;

    rehydrator.scanAndRehydrateTextNode(textNode);

    const span = msg.querySelector('span.prompt-shield-rehydrated') as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('sk-proj-test-secret-value-123');
    expect(span.getAttribute('title')).toContain('[SECRET_1]');
    expect(msg.textContent).toContain('Here is your sanitized secret: sk-proj-test-secret-value-123. Do not share it.');
  });

  it('clearVault() resets internal vaultMap and stops rehydrating previous tokens', () => {
    const rehydrator = new ResponseRehydrator(
      { '[SECRET_1]': 'initial-secret-123' },
      true
    );
    expect(rehydrator.getVaultMap()).toEqual({ '[SECRET_1]': 'initial-secret-123' });

    rehydrator.clearVault();
    expect(rehydrator.getVaultMap()).toEqual({});

    const msg = document.getElementById('msg-1')!;
    msg.textContent = 'Token [SECRET_1] should not rehydrate';
    const textNode = msg.firstChild as Text;
    rehydrator.scanAndRehydrateTextNode(textNode);

    // Because vaultMap was cleared, [SECRET_1] should remain untouched text
    expect(msg.querySelector('span.prompt-shield-rehydrated')).toBeNull();
    expect(msg.textContent).toBe('Token [SECRET_1] should not rehydrate');
  });

  it('deep-merges GET_SETTINGS with DEFAULT_SETTINGS preserving enabledRules defaults', () => {
    const interceptor = new PromptInterceptor();
    const partialSettings = {
      enabled: true,
      mode: 'auto' as const,
      enabledRules: {
        EMAIL: false,
      } as any,
    };

    const merged = interceptor.mergeSettings(partialSettings);
    expect(merged.enabledRules.EMAIL).toBe(false);
    // Preserved default rules
    expect(merged.enabledRules.SECRET).toBe(true);
    expect(merged.enabledRules.CONNECTION_URI).toBe(true);
    expect(merged.enabledRules.PASSWORD).toBe(true);
    expect(merged.enabledRules.CREDIT_CARD).toBe(true);
  });
});
