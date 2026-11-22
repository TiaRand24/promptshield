export class UIOverlay {
  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Lazy initialization: defer DOM host attachment until UI is actually rendered
  }

  private ensureHost(): ShadowRoot | null {
    if (typeof document === 'undefined') return null;

    const target = document.body || document.documentElement;
    if (!target) return null;

    if (this.shadowRoot && this.hostElement && target.contains(this.hostElement)) {
      // If we initially attached to documentElement before body existed, migrate to body if body is now ready
      if (document.body && this.hostElement.parentElement !== document.body) {
        document.body.appendChild(this.hostElement);
      }
      return this.shadowRoot;
    }

    // Clean up any stale host
    const existing = document.getElementById('prompt-shield-overlay-root');
    if (existing) {
      existing.remove();
    }

    const host = document.createElement('div');
    host.id = 'prompt-shield-overlay-root';
    host.style.position = 'fixed';
    host.style.bottom = '24px';
    host.style.right = '24px';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';

    const shadow = host.attachShadow({ mode: 'open' });
    target.appendChild(host);

    this.hostElement = host;
    this.shadowRoot = shadow;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .shield-pill {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        background: #111827;
        color: #f9fafb;
        padding: 10px 16px;
        border-radius: 9999px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
        border: 1px solid #374151;
        font-size: 13px;
        font-weight: 500;
        animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .shield-pill .icon {
        font-size: 16px;
      }
      .shield-pill .badge {
        background: #4f46e5;
        color: #ffffff;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 700;
      }
      .shield-pill button.undo-btn {
        background: transparent;
        border: 1px solid #4b5563;
        color: #e5e7eb;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: background 0.15s;
      }
      .shield-pill button.undo-btn:hover {
        background: #374151;
        color: #fff;
      }
      .review-backdrop {
        pointer-events: auto;
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        animation: fadeIn 0.2s ease-out;
      }
      .review-modal {
        background: #18181b;
        color: #fafafa;
        border: 1px solid #27272a;
        border-radius: 12px;
        width: 90%;
        max-width: 600px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .modal-title {
        font-size: 17px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .diff-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 280px;
        overflow-y: auto;
      }
      .diff-box {
        background: #09090b;
        border: 1px solid #27272a;
        border-radius: 8px;
        padding: 12px;
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .diff-box.original {
        border-color: #ef4444;
        color: #fca5a5;
      }
      .diff-box.sanitized {
        border-color: #10b981;
        color: #6ee7b7;
      }
      .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 8px;
      }
      .btn {
        padding: 8px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: opacity 0.15s;
      }
      .btn:hover {
        opacity: 0.9;
      }
      .btn-cancel {
        background: #27272a;
        color: #e4e4e7;
      }
      .btn-bypass {
        background: #dc2626;
        color: #ffffff;
      }
      .btn-approve {
        background: #4f46e5;
        color: #ffffff;
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    `;
    shadow.appendChild(style);

    return shadow;
  }

  /**
   * Generic show alias with guard against <= 0
   */
  public show(count: number, onUndo: () => void = () => {}): void {
    if (count <= 0) return;
    this.showAutoSanitizedPill(count, onUndo);
  }

  /**
   * Flashes a non-intrusive status pill near the chat UI
   */
  public showAutoSanitizedPill(count: number, onUndo: () => void = () => {}): void {
    // Strictly guard against <= 0 so zero changes never render or overwrite an active pill
    if (count <= 0) return;

    const shadow = this.ensureHost();
    if (!shadow) return;

    // Clear previous elements and timer
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
    }
    const oldPill = shadow.querySelector('.shield-pill');
    if (oldPill) oldPill.remove();

    const pill = document.createElement('div');
    pill.className = 'shield-pill';
    pill.innerHTML = `
      <span class="icon">🛡️</span>
      <span>PromptShield: <span class="badge">${count} ${count === 1 ? 'secret' : 'secrets'} tokenized</span></span>
      <button class="undo-btn">Undo (3s)</button>
    `;

    const undoBtn = pill.querySelector('.undo-btn');
    let undone = false;
    undoBtn?.addEventListener('click', () => {
      undone = true;
      pill.remove();
      onUndo();
    });

    shadow.appendChild(pill);

    // Auto dismiss after 3 seconds
    this.autoDismissTimer = setTimeout(() => {
      if (!undone && pill.parentElement) {
        pill.style.opacity = '0';
        pill.style.transition = 'opacity 0.3s ease-out';
        setTimeout(() => pill.remove(), 300);
      }
    }, 3000);
  }

  /**
   * Shows an inline Review Before Sending modal
   */
  public showReviewModal(
    originalText: string,
    sanitizedText: string,
    onApprove: () => void,
    onBypass: () => void,
    onCancel: () => void
  ): void {
    const shadow = this.ensureHost();
    if (!shadow) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'review-backdrop';
    backdrop.innerHTML = `
      <div class="review-modal">
        <div class="modal-header">
          <div class="modal-title">
            <span>🛡️</span>
            <span>Review Tokenized Prompt</span>
          </div>
        </div>
        <p style="margin: 0; font-size: 13px; color: #a1a1aa;">
          PromptShield detected sensitive entities in your prompt. Choose how to proceed:
        </p>
        <div class="diff-container">
          <div style="font-size: 11px; text-transform: uppercase; color: #ef4444; font-weight: 700;">Original (Sensitive)</div>
          <div class="diff-box original">${this.escapeHTML(originalText)}</div>
          <div style="font-size: 11px; text-transform: uppercase; color: #10b981; font-weight: 700;">Sanitized (Safe for AI)</div>
          <div class="diff-box sanitized">${this.escapeHTML(sanitizedText)}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-cancel">Cancel</button>
          <button class="btn btn-bypass">Send Unsanitized</button>
          <button class="btn btn-approve">Sanitize & Send</button>
        </div>
      </div>
    `;

    const cancelBtn = backdrop.querySelector('.btn-cancel');
    const bypassBtn = backdrop.querySelector('.btn-bypass');
    const approveBtn = backdrop.querySelector('.btn-approve');

    cancelBtn?.addEventListener('click', () => {
      backdrop.remove();
      onCancel();
    });

    bypassBtn?.addEventListener('click', () => {
      backdrop.remove();
      onBypass();
    });

    approveBtn?.addEventListener('click', () => {
      backdrop.remove();
      onApprove();
    });

    shadow.appendChild(backdrop);
  }

  public clear(): void {
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
    }
    if (this.shadowRoot) {
      const pill = this.shadowRoot.querySelector('.shield-pill');
      if (pill) pill.remove();
      const backdrop = this.shadowRoot.querySelector('.review-backdrop');
      if (backdrop) backdrop.remove();
    }
  }

  private escapeHTML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
