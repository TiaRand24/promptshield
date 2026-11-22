export interface DOMAdapter {
  name: string;
  matches: (url: string) => boolean;
  getInputElement: () => HTMLElement | null;
  getSendButton: () => HTMLElement | null;
  getChatContainer: () => HTMLElement | null;
  getPromptText: (el: HTMLElement) => string;
  setPromptText: (el: HTMLElement, text: string) => boolean;
  triggerSubmit: (el: HTMLElement, sendBtn: HTMLElement | null) => void;
}

export function isEditableElement(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const attr = el.getAttribute('contenteditable');
  return attr !== null && attr !== 'false';
}

/**
 * Native value setter for HTMLTextAreaElement to ensure React 16+ registers programmatic changes
 */
function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const prototype = window.HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  const nativeSetter = descriptor?.set;

  if (nativeSetter) {
    nativeSetter.call(textarea, value);
  } else {
    textarea.value = value;
  }

  // Dispatch standard synthetic input and change events
  const inputEvent = new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    data: value,
    inputType: 'insertText',
  });
  (inputEvent as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
  textarea.dispatchEvent(inputEvent);
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Sets text content in ProseMirror or contenteditable elements.
 * Uses synthetic ClipboardEvent('paste') with DataTransfer to force ProseMirror's EditorState update,
 * with execCommand and DOM paragraph fallbacks.
 */
function setContentEditableValue(el: HTMLElement, value: string): void {
  el.focus();

  // 1. Focus el and select all contents via Selection and Range
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);

  // 2. Dispatch synthetic beforeinput with 'deleteContentBackward' or call execCommand('delete')
  try {
    el.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward',
      })
    );
    document.execCommand('delete', false);
  } catch {
    // Ignore environments lacking execCommand
  }

  // 3. Construct DataTransfer and dispatch synthetic ClipboardEvent('paste') to force ProseMirror update
  let pasteProcessed = false;
  try {
    const DT =
      typeof DataTransfer !== 'undefined'
        ? DataTransfer
        : typeof window !== 'undefined'
          ? (window as unknown as { DataTransfer: typeof DataTransfer }).DataTransfer
          : undefined;
    const CE =
      typeof ClipboardEvent !== 'undefined'
        ? ClipboardEvent
        : typeof window !== 'undefined'
          ? (window as unknown as { ClipboardEvent: typeof ClipboardEvent }).ClipboardEvent
          : undefined;

    if (DT && CE) {
      const dt = new DT();
      dt.setData('text/plain', value);
      const pasteEvent = new CE('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      (pasteEvent as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
      const cancelled = !el.dispatchEvent(pasteEvent);
      // If ProseMirror handled the paste, cancelled is true (defaultPrevented)
      if (cancelled) {
        pasteProcessed = true;
      }
    }
  } catch {
    pasteProcessed = false;
  }

  // 4. If paste event did not process or didn't update DOM, fall back to execCommand('insertText')
  if (!pasteProcessed) {
    try {
      pasteProcessed = document.execCommand('insertText', false, value);
    } catch {
      pasteProcessed = false;
    }
  }

  // 5. Final DOM fallback: clear children and build <p> paragraph nodes
  if (!pasteProcessed || !el.textContent?.includes(value.slice(0, 20))) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    const lines = value.split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line || '\u200B';
      el.appendChild(p);
    }
  }

  // Dispatch InputEvent so ProseMirror / framework input listeners trigger
  const syntheticInput = new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    data: value,
    inputType: 'insertText',
  });
  (syntheticInput as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
  el.dispatchEvent(syntheticInput);
}

/**
 * ChatGPT Adapter (chatgpt.com / chat.openai.com)
 */
export const ChatGPTAdapter: DOMAdapter = {
  name: 'ChatGPT',
  matches: (url: string) => url.includes('chatgpt.com') || url.includes('chat.openai.com'),
  getInputElement: () => {
    return (
      (document.querySelector('#prompt-textarea') as HTMLElement) ||
      (document.querySelector('div[contenteditable="true"]#prompt-textarea') as HTMLElement) ||
      (document.querySelector('div.ProseMirror[contenteditable="true"]') as HTMLElement) ||
      (document.querySelector('textarea[data-id="root"]') as HTMLElement)
    );
  },
  getSendButton: () => {
    return (
      (document.querySelector('button[data-testid="send-button"]') as HTMLElement) ||
      (document.querySelector('button[data-testid="fruitjuice-send-button"]') as HTMLElement) ||
      (document.querySelector('button[data-testid*="send"]') as HTMLElement) ||
      (document.querySelector('button[aria-label="Send prompt"]') as HTMLElement) ||
      (document.querySelector('button[aria-label="Send message"]') as HTMLElement) ||
      (document.querySelector('button[aria-label="Send"]') as HTMLElement) ||
      (document.querySelector('form button[type="submit"]') as HTMLElement)
    );
  },
  getChatContainer: () => {
    return (
      (document.querySelector('main div[data-testid="conversation-turn-list"]') as HTMLElement) ||
      (document.querySelector('main') as HTMLElement)
    );
  },
  getPromptText: (el: HTMLElement) => {
    // ChatGPT ProseMirror uses child <p> elements inside contenteditable div
    const paragraphs = Array.from(el.querySelectorAll('p'));
    if (paragraphs.length > 0) {
      return paragraphs.map((p) => p.innerText || p.textContent || '').join('\n');
    }
    if (el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    return el.innerText || el.textContent || '';
  },
  setPromptText: (el: HTMLElement, text: string) => {
    // #prompt-textarea is ProseMirror contenteditable div; prioritize contenteditable handling
    if (isEditableElement(el) || el.classList.contains('ProseMirror') || el.getAttribute('contenteditable') === 'true') {
      setContentEditableValue(el, text);
      return true;
    }
    if (el instanceof HTMLTextAreaElement) {
      setReactTextareaValue(el, text);
      return true;
    }
    setContentEditableValue(el, text);
    return true;
  },
  triggerSubmit: (el: HTMLElement, sendBtn: HTMLElement | null) => {
    const activeBtn =
      (sendBtn && document.body.contains(sendBtn) && !sendBtn.hasAttribute('disabled') ? sendBtn : null) ||
      ChatGPTAdapter.getSendButton();

    if (activeBtn && !activeBtn.hasAttribute('disabled')) {
      (activeBtn as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
      activeBtn.click();
    } else {
      // Simulate enter keypress
      const enterDown = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      (enterDown as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
      el.dispatchEvent(enterDown);
    }
  },
};

/**
 * Claude Adapter (claude.ai)
 */
export const ClaudeAdapter: DOMAdapter = {
  name: 'Claude',
  matches: (url: string) => url.includes('claude.ai'),
  getInputElement: () => {
    return (
      (document.querySelector('div[contenteditable="true"].ProseMirror') as HTMLElement) ||
      (document.querySelector('div[contenteditable="true"]') as HTMLElement)
    );
  },
  getSendButton: () => {
    return (
      (document.querySelector('button[aria-label="Send Message"]') as HTMLElement) ||
      (document.querySelector('button[aria-label="Send prompt"]') as HTMLElement) ||
      (document.querySelector('fieldset button:last-child') as HTMLElement)
    );
  },
  getChatContainer: () => {
    return (
      (document.querySelector('div.font-claude-message') as HTMLElement) ||
      (document.querySelector('div[data-is-streaming]') as HTMLElement) ||
      (document.querySelector('main') as HTMLElement)
    );
  },
  getPromptText: (el: HTMLElement) => {
    if (el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    return el.innerText || el.textContent || '';
  },
  setPromptText: (el: HTMLElement, text: string) => {
    setContentEditableValue(el, text);
    return true;
  },
  triggerSubmit: (el: HTMLElement, sendBtn: HTMLElement | null) => {
    if (sendBtn && !sendBtn.hasAttribute('disabled')) {
      sendBtn.click();
    } else {
      const enterDown = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      (enterDown as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
      el.dispatchEvent(enterDown);
    }
  },
};

/**
 * Gemini Adapter (gemini.google.com)
 */
export const GeminiAdapter: DOMAdapter = {
  name: 'Gemini',
  matches: (url: string) => url.includes('gemini.google.com'),
  getInputElement: () => {
    return (
      (document.querySelector('div.ql-editor[contenteditable="true"]') as HTMLElement) ||
      (document.querySelector('rich-textarea div[contenteditable="true"]') as HTMLElement) ||
      (document.querySelector('textarea.textarea') as HTMLElement)
    );
  },
  getSendButton: () => {
    return (
      (document.querySelector('button.send-button') as HTMLElement) ||
      (document.querySelector('button[aria-label="Submit"]') as HTMLElement) ||
      (document.querySelector('button[aria-label="Send message"]') as HTMLElement)
    );
  },
  getChatContainer: () => {
    return (
      (document.querySelector('message-content') as HTMLElement) ||
      (document.querySelector('div.conversation-container') as HTMLElement) ||
      (document.querySelector('main') as HTMLElement)
    );
  },
  getPromptText: (el: HTMLElement) => {
    if (el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    return el.innerText || el.textContent || '';
  },
  setPromptText: (el: HTMLElement, text: string) => {
    if (el instanceof HTMLTextAreaElement) {
      setReactTextareaValue(el, text);
      return true;
    }
    setContentEditableValue(el, text);
    return true;
  },
  triggerSubmit: (el: HTMLElement, sendBtn: HTMLElement | null) => {
    if (sendBtn && !sendBtn.hasAttribute('disabled')) {
      sendBtn.click();
    } else {
      const enterDown = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      (enterDown as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
      el.dispatchEvent(enterDown);
    }
  },
};

/**
 * Generic Fallback Adapter (for test harness or newly styled web chat interfaces)
 */
export const GenericAdapter: DOMAdapter = {
  name: 'Generic',
  matches: () => true,
  getInputElement: () => {
    return (
      (document.querySelector('#prompt-textarea') as HTMLElement) ||
      (document.querySelector('div[contenteditable="true"].ProseMirror') as HTMLElement) ||
      (document.querySelector('textarea') as HTMLElement) ||
      (document.querySelector('div[contenteditable="true"]') as HTMLElement)
    );
  },
  getSendButton: () => {
    return (
      (document.querySelector('button[id*="send"]') as HTMLElement) ||
      (document.querySelector('button[class*="send"]') as HTMLElement) ||
      (document.querySelector('button[type="submit"]') as HTMLElement) ||
      (document.querySelector('button') as HTMLElement)
    );
  },
  getChatContainer: () => {
    return (
      (document.querySelector('#chat-transcript') as HTMLElement) ||
      (document.querySelector('main') as HTMLElement) ||
      document.body
    );
  },
  getPromptText: (el: HTMLElement) => {
    if (el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    return el.innerText || el.textContent || '';
  },
  setPromptText: (el: HTMLElement, text: string) => {
    if (el instanceof HTMLTextAreaElement) {
      setReactTextareaValue(el, text);
      return true;
    }
    if (isEditableElement(el)) {
      setContentEditableValue(el, text);
      return true;
    }
    el.textContent = text;
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertText',
      })
    );
    return true;
  },
  triggerSubmit: (el: HTMLElement, sendBtn: HTMLElement | null) => {
    if (sendBtn && !sendBtn.hasAttribute('disabled')) {
      sendBtn.click();
    } else {
      const enterDown = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      (enterDown as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
      el.dispatchEvent(enterDown);
    }
  },
};

export const ALL_ADAPTERS: DOMAdapter[] = [
  ChatGPTAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  GenericAdapter,
];

export function getActiveAdapter(url: string = window.location.href): DOMAdapter {
  for (const adapter of ALL_ADAPTERS) {
    if (adapter.matches(url)) {
      return adapter;
    }
  }
  return GenericAdapter;
}
