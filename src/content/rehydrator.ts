import { DOMAdapter } from './dom-adapters';

const TOKEN_PATTERN = /\[(EMAIL|SECRET|CREDIT_CARD|SSN|PHONE|IP|CUSTOM|CONNECTION_URI|PASSWORD)_\d+\]/g;

export class ResponseRehydrator {
  private observer: MutationObserver | null = null;
  private vaultMap: Record<string, string> = {};
  private enabled: boolean = true;
  private processedNodes: WeakSet<Node> = new WeakSet();
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMutations: MutationRecord[] = [];

  constructor(vaultMap: Record<string, string> = {}, enabled: boolean = true) {
    this.vaultMap = vaultMap;
    this.enabled = enabled;
  }

  public updateVault(vaultMap: Record<string, string>): void {
    this.vaultMap = { ...this.vaultMap, ...vaultMap };
  }

  public clearVault(): void {
    this.vaultMap = {};
  }

  public getVaultMap(): Record<string, string> {
    return { ...this.vaultMap };
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Starts observing the chat container for streaming tokens
   */
  public startObserving(adapter: DOMAdapter): void {
    this.stopObserving();

    const container = adapter.getChatContainer() || document.body || document.documentElement;
    if (!container) return;

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled || Object.keys(this.vaultMap).length === 0) return;

      this.pendingMutations.push(...mutations);
      if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.processMutations();
          this.throttleTimer = null;
        }, 50);
      }
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  public stopObserving(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingMutations = [];
  }

  private processMutations(): void {
    const mutations = [...this.pendingMutations];
    this.pendingMutations = [];

    // Temporarily pause observation while mutating to prevent recursive mutation events
    if (this.observer) {
      this.observer.disconnect();
    }

    try {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' && mutation.target) {
          this.scanAndRehydrateTextNode(mutation.target as Text);
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            this.scanNodeRecursive(node);
          });
        }
      }
    } finally {
      // Resume observation
      if (this.observer) {
        const container =
          document.querySelector('#prompt-textarea')?.closest('main') ||
          document.body ||
          document.documentElement;
        if (container) {
          this.observer.observe(container, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }
      }
    }
  }

  private scanNodeRecursive(node: Node): void {
    if (this.processedNodes.has(node)) return;

    if (node instanceof HTMLElement) {
      if (
        node.classList.contains('prompt-shield-rehydrated') ||
        node.id === 'prompt-shield-overlay-root' ||
        node.tagName === 'TEXTAREA' ||
        node.tagName === 'INPUT'
      ) {
        return;
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      this.scanAndRehydrateTextNode(node as Text);
      return;
    }

    node.childNodes.forEach((child) => {
      this.scanNodeRecursive(child);
    });
  }

  /**
   * Replaces token text inside a single Text node with interactive styled spans
   */
  public scanAndRehydrateTextNode(textNode: Text): void {
    if (this.processedNodes.has(textNode)) return;
    const text = textNode.nodeValue;
    if (!text || !TOKEN_PATTERN.test(text)) return;

    // Reset regex index
    TOKEN_PATTERN.lastIndex = 0;

    let hasMatches = false;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TOKEN_PATTERN.exec(text)) !== null) {
      const token = match[0];
      const originalValue = this.vaultMap[token];

      if (originalValue) {
        hasMatches = true;
        // Text before token
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        // Highlighted rehydrated span
        const span = document.createElement('span');
        span.className = 'prompt-shield-rehydrated';
        span.setAttribute('data-ps-rehydrated', 'true');
        span.setAttribute('title', `PromptShield Token: ${token}`);
        span.style.borderBottom = '1.5px dotted #6366f1';
        span.style.cursor = 'help';
        span.style.background = 'rgba(99, 102, 241, 0.12)';
        span.style.padding = '0 2px';
        span.style.borderRadius = '3px';
        span.textContent = originalValue;

        this.processedNodes.add(span);
        fragment.appendChild(span);

        lastIndex = match.index + token.length;
      }
    }

    if (hasMatches) {
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      this.processedNodes.add(fragment);
      textNode.replaceWith(fragment);
    }
  }
}
