import { DEFAULT_SETTINGS, sanitizePrompt } from '../engine/sanitizer';
import { EntityVault } from '../engine/vault';
import { ExtensionMessage, ExtensionSettings, SyncVaultPayload } from '../types';
import { DOMAdapter, getActiveAdapter } from './dom-adapters';
import { ResponseRehydrator } from './rehydrator';
import { UIOverlay } from './ui-overlay';

export class PromptInterceptor {
  private adapter: DOMAdapter;
  private vault: EntityVault;
  private settings: ExtensionSettings;
  private overlay: UIOverlay;
  private rehydrator: ResponseRehydrator;
  private isBypassingInterceptor: boolean = false;
  private isSubmitting: boolean = false;
  private isMutatingDOM: boolean = false;
  private isListenersAttached: boolean = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private boundPaste = this.handlePaste.bind(this);
  private boundPointerDown = this.handlePointerDown.bind(this);
  private boundMouseDown = this.handleMouseDown.bind(this);
  private boundKeyDown = this.handleKeyDown.bind(this);
  private boundClick = this.handleClick.bind(this);
  private boundInput = this.handleInput.bind(this);
  private boundFocusOut = this.handleFocusOut.bind(this);

  constructor() {
    this.adapter = getActiveAdapter();
    this.vault = new EntityVault();
    this.settings = this.mergeSettings();
    this.overlay = new UIOverlay();
    this.rehydrator = new ResponseRehydrator();
  }

  public mergeSettings(incoming?: Partial<ExtensionSettings> | null): ExtensionSettings {
    if (!incoming) {
      return {
        ...DEFAULT_SETTINGS,
        enabledRules: { ...DEFAULT_SETTINGS.enabledRules },
      };
    }
    return {
      ...DEFAULT_SETTINGS,
      ...incoming,
      enabledRules: {
        ...DEFAULT_SETTINGS.enabledRules,
        ...(incoming.enabledRules || {}),
      },
      customWords: Array.isArray(incoming.customWords)
        ? [...incoming.customWords]
        : [...DEFAULT_SETTINGS.customWords],
    };
  }

  public async init(): Promise<void> {
    // 1. Immediately attach event listeners synchronously before any async ticks or host scripts run
    this.attachEventListeners();

    // 2. Schedule DOM observer & overlay initialization when DOM is ready
    this.initDOMObservers();

    // 3. Load initial state from background service worker
    await this.loadInitialState();
  }

  private initDOMObservers(): void {
    if (typeof document === 'undefined') return;

    const startObservers = () => {
      this.rehydrator.startObserving(this.adapter);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObservers, { once: true });
    } else {
      startObservers();
    }
  }

  private async loadInitialState(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        // Fetch saved settings
        const settingsRes = await chrome.runtime.sendMessage<
          ExtensionMessage,
          ExtensionSettings
        >({ type: 'GET_SETTINGS' });
        if (settingsRes) {
          this.settings = this.mergeSettings(settingsRes);
        }

        // Fetch active session vault
        const vaultRes = await chrome.runtime.sendMessage<
          ExtensionMessage,
          Record<string, string>
        >({ type: 'GET_VAULT' });
        if (vaultRes) {
          this.vault.loadState({ tokenToOriginal: vaultRes });
          this.rehydrator.updateVault(vaultRes);
        }

        // Listen for setting updates or vault resets from popup
        chrome.runtime.onMessage?.addListener((msg: ExtensionMessage) => {
          if (msg.type === 'UPDATE_SETTINGS' && msg.payload) {
            this.settings = this.mergeSettings(msg.payload as Partial<ExtensionSettings>);
            this.rehydrator.setEnabled(this.settings.rehydrateReplies);
          } else if (msg.type === 'CLEAR_VAULT') {
            this.vault.clear();
            this.rehydrator.clearVault();
          }
        });
      }
    } catch {
      // In isolated test runner or without background worker
    }
  }

  public attachEventListeners(): void {
    if (this.isListenersAttached) return;
    this.isListenersAttached = true;

    window.addEventListener('paste', this.boundPaste, { capture: true });
    window.addEventListener('pointerdown', this.boundPointerDown, { capture: true });
    window.addEventListener('mousedown', this.boundMouseDown, { capture: true });
    window.addEventListener('keydown', this.boundKeyDown, { capture: true });
    window.addEventListener('click', this.boundClick, { capture: true });
    window.addEventListener('input', this.boundInput, { capture: true });
    window.addEventListener('focusout', this.boundFocusOut, { capture: true });
  }

  public destroy(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.isListenersAttached) {
      window.removeEventListener('paste', this.boundPaste, { capture: true });
      window.removeEventListener('pointerdown', this.boundPointerDown, { capture: true });
      window.removeEventListener('mousedown', this.boundMouseDown, { capture: true });
      window.removeEventListener('keydown', this.boundKeyDown, { capture: true });
      window.removeEventListener('click', this.boundClick, { capture: true });
      window.removeEventListener('input', this.boundInput, { capture: true });
      window.removeEventListener('focusout', this.boundFocusOut, { capture: true });
      this.isListenersAttached = false;
    }
    this.rehydrator.stopObserving();
    this.overlay.clear();
  }

  private getEditableTarget(target: HTMLElement | null): HTMLElement | null {
    if (!target) return this.adapter.getInputElement();
    const inputEl = this.adapter.getInputElement();
    if (inputEl && (target === inputEl || inputEl.contains(target as Node))) {
      return inputEl;
    }
    if (
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.getAttribute('contenteditable') === 'true' ||
      target.classList.contains('ProseMirror') ||
      target.classList.contains('ql-editor')
    ) {
      return target;
    }
    const closest = target.closest<HTMLElement>(
      'textarea, [contenteditable="true"], .ProseMirror, .ql-editor'
    );
    if (closest) return closest;
    return inputEl;
  }

  /**
   * Real-time in-place sanitization for typed content.
   */
  public sanitizeInPlace(inputEl: HTMLElement): boolean {
    if (!this.settings.enabled || this.isMutatingDOM || this.isBypassingInterceptor) {
      return false;
    }

    const rawText = this.adapter.getPromptText(inputEl);
    if (!rawText || rawText.trim().length === 0) return false;

    const result = sanitizePrompt(rawText, this.vault, this.settings);
    if (!result.hasChanges || result.matchCount <= 0) {
      return false;
    }

    this.isMutatingDOM = true;
    this.isBypassingInterceptor = true;
    try {
      this.adapter.setPromptText(inputEl, result.sanitizedText);
    } finally {
      this.isBypassingInterceptor = false;
      this.isMutatingDOM = false;
    }

    // Sync vault mappings
    this.syncVaultWithBackground(result.delta.newMappings);

    // Display status pill with total matched entities
    if (result.matchCount > 0) {
      this.overlay.showAutoSanitizedPill(result.matchCount, () => {
        this.isMutatingDOM = true;
        this.isBypassingInterceptor = true;
        try {
          this.adapter.setPromptText(inputEl, rawText);
        } finally {
          this.isBypassingInterceptor = false;
          this.isMutatingDOM = false;
        }
      });
    }

    return true;
  }

  public handleInput(event: Event): void {
    if (
      this.isMutatingDOM ||
      this.isBypassingInterceptor ||
      (event as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass
    ) {
      return;
    }
    if (!this.settings.enabled) return;

    const targetEl = this.getEditableTarget(event.target as HTMLElement | null);
    if (!targetEl) return;

    const inputEvent = event as InputEvent;
    const isImmediate =
      inputEvent.data === ' ' ||
      inputEvent.data === '\n' ||
      inputEvent.inputType === 'insertLineBreak' ||
      inputEvent.inputType === 'insertParagraph';

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (isImmediate) {
      this.sanitizeInPlace(targetEl);
    } else {
      this.debounceTimer = setTimeout(() => {
        this.sanitizeInPlace(targetEl);
        this.debounceTimer = null;
      }, 300);
    }
  }

  public handleFocusOut(event: FocusEvent): void {
    if (
      this.isMutatingDOM ||
      this.isBypassingInterceptor ||
      (event as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass
    ) {
      return;
    }
    if (!this.settings.enabled) return;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const targetEl = this.getEditableTarget(event.target as HTMLElement | null);
    if (targetEl) {
      this.sanitizeInPlace(targetEl);
    }
  }

  /**
   * Layer 1 Defense: Intercept paste events in capture phase so secrets NEVER enter ProseMirror EditorState.
   */
  public handlePaste(event: ClipboardEvent): void {
    if (
      this.isMutatingDOM ||
      this.isBypassingInterceptor ||
      (event as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass
    ) {
      return;
    }
    if (!this.settings.enabled) return;

    const targetEl = this.getEditableTarget(event.target as HTMLElement | null);
    if (!targetEl) return;

    const pastedText = event.clipboardData?.getData('text/plain');
    if (!pastedText || pastedText.trim().length === 0) return;

    const result = sanitizePrompt(pastedText, this.vault, this.settings);
    if (!result.hasChanges || result.matchCount <= 0) return;

    // Immediately halt raw paste
    event.preventDefault();
    event.stopImmediatePropagation();

    // Sync vault
    this.syncVaultWithBackground(result.delta.newMappings);

    // Show status pill ("N secrets tokenized on paste") with matchCount
    if (result.matchCount > 0) {
      this.overlay.showAutoSanitizedPill(result.matchCount, () => {});
    }

    // Insert the sanitized text directly into the active cursor position
    this.isMutatingDOM = true;
    try {
      this.insertSanitizedTextAtCursor(targetEl, result.sanitizedText);
    } finally {
      this.isMutatingDOM = false;
    }
  }

  private insertSanitizedTextAtCursor(el: HTMLElement, sanitizedText: string): void {
    let handled = false;
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
        dt.setData('text/plain', sanitizedText);
        const syntheticPaste = new CE('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        (syntheticPaste as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
        handled = !el.dispatchEvent(syntheticPaste);
      }
    } catch {
      handled = false;
    }

    if (!handled) {
      try {
        handled = document.execCommand('insertText', false, sanitizedText);
      } catch {
        handled = false;
      }
    }

    if (!handled && el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const val = el.value;
      el.value = val.slice(0, start) + sanitizedText + val.slice(end);
      el.selectionStart = el.selectionEnd = start + sanitizedText.length;
      const syntheticInput = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: sanitizedText,
        inputType: 'insertText',
      });
      (syntheticInput as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
      el.dispatchEvent(syntheticInput);
    }
  }

  public handleKeyDown(event: KeyboardEvent): void {
    if (
      this.isMutatingDOM ||
      this.isBypassingInterceptor ||
      (event as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass
    ) {
      return;
    }

    // Only intercept plain Enter key (no shift, ctrl, meta, alt, and not during IME composition)
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.isComposing
    ) {
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }

      const inputEl = this.adapter.getInputElement();
      // Check if target is inside or is the active prompt input
      if (inputEl && (event.target === inputEl || inputEl.contains(event.target as Node))) {
        this.interceptAndSanitize(event, inputEl);
      }
    }
  }

  /**
   * Layer 3 Defense: Early submission interception on pointerdown, mousedown, and click.
   * Prevents ChatGPT / modern React from submitting on pointerdown before click fires.
   */
  public handlePointerDown(event: Event): void {
    this.handleSendButtonPress(event);
  }

  public handleMouseDown(event: MouseEvent): void {
    this.handleSendButtonPress(event);
  }

  public handleClick(event: MouseEvent): void {
    this.handleSendButtonPress(event);
  }

  private handleSendButtonPress(event: Event): void {
    if (
      this.isMutatingDOM ||
      this.isBypassingInterceptor ||
      (event as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass
    ) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) return;

    const btn = target.closest('button');
    if (!btn) return;

    const adapterBtn = this.adapter.getSendButton();
    const isTargetSendBtn =
      (adapterBtn && (adapterBtn === btn || adapterBtn.contains(btn))) ||
      this.isSendLikeButton(btn);

    if (isTargetSendBtn) {
      // If submission cycle is already in progress, suppress native pointerdown/mousedown/click
      if (this.isSubmitting) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      // Find the corresponding input element: either within the same container, or default
      const parent = btn.closest('form, [data-panel], .panel, fieldset, main, body');
      const localInput = parent?.querySelector<HTMLElement>(
        '#prompt-textarea, div[contenteditable="true"].ProseMirror, div.ql-editor[contenteditable="true"], textarea, div[contenteditable="true"]'
      );
      const inputEl = localInput || this.adapter.getInputElement();

      if (inputEl) {
        this.interceptAndSanitize(event, inputEl, btn);
      }
    }
  }

  private isSendLikeButton(btn: HTMLElement): boolean {
    const id = btn.id.toLowerCase();
    const cls = btn.className.toLowerCase();
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
    const text = (btn.textContent || '').trim().toLowerCase();
    return (
      id.includes('send') ||
      cls.includes('send') ||
      label.includes('send') ||
      label.includes('submit') ||
      testId.includes('send') ||
      testId.includes('submit') ||
      text.includes('send') ||
      (btn as HTMLButtonElement).type === 'submit'
    );
  }

  public interceptAndSanitize(event: Event, inputEl: HTMLElement, triggerBtn?: HTMLElement | null): void {
    if (!this.settings.enabled) return;

    const rawText = this.adapter.getPromptText(inputEl);
    if (!rawText || rawText.trim().length === 0) return;

    const result = sanitizePrompt(rawText, this.vault, this.settings);
    if (!result.hasChanges || result.matchCount <= 0) {
      // Nothing to sanitize, let native submit proceed
      return;
    }

    // Halt original submit
    event.preventDefault();
    event.stopImmediatePropagation();

    const sendBtn = triggerBtn || this.adapter.getSendButton();

    if (this.settings.mode === 'auto') {
      this.executeAutoSanitize(
        inputEl,
        rawText,
        result.sanitizedText,
        result.delta.newMappings,
        sendBtn,
        result.matchCount
      );
    } else {
      this.executeReviewMode(
        inputEl,
        rawText,
        result.sanitizedText,
        result.delta.newMappings,
        sendBtn,
        result.matchCount
      );
    }
  }

  private executeAutoSanitize(
    inputEl: HTMLElement,
    originalText: string,
    sanitizedText: string,
    newMappings: Record<string, string>,
    sendBtn: HTMLElement | null,
    matchCount: number
  ): void {
    // Replace text in DOM with sanitized tokens under DOM mutation lock
    this.isMutatingDOM = true;
    try {
      this.adapter.setPromptText(inputEl, sanitizedText);
    } finally {
      this.isMutatingDOM = false;
    }

    // Sync vault
    this.syncVaultWithBackground(newMappings);

    // Show undo pill with matchCount (never 0)
    if (matchCount > 0) {
      this.overlay.showAutoSanitizedPill(matchCount, () => {
        // Revert text on undo
        this.isMutatingDOM = true;
        try {
          this.adapter.setPromptText(inputEl, originalText);
        } finally {
          this.isMutatingDOM = false;
        }
      });
    }

    // Re-dispatch submit action safely
    this.dispatchSafeSubmit(inputEl, sendBtn);
  }

  private executeReviewMode(
    inputEl: HTMLElement,
    originalText: string,
    sanitizedText: string,
    newMappings: Record<string, string>,
    sendBtn: HTMLElement | null,
    _matchCount: number
  ): void {
    this.overlay.showReviewModal(
      originalText,
      sanitizedText,
      // On Approve:
      () => {
        this.isMutatingDOM = true;
        try {
          this.adapter.setPromptText(inputEl, sanitizedText);
        } finally {
          this.isMutatingDOM = false;
        }
        this.syncVaultWithBackground(newMappings);
        this.dispatchSafeSubmit(inputEl, sendBtn);
      },
      // On Bypass (send unsanitized):
      () => {
        this.isMutatingDOM = true;
        try {
          this.adapter.setPromptText(inputEl, originalText);
        } finally {
          this.isMutatingDOM = false;
        }
        this.dispatchSafeSubmit(inputEl, sendBtn);
      },
      // On Cancel:
      () => {
        // Keep original text
        this.isMutatingDOM = true;
        try {
          this.adapter.setPromptText(inputEl, originalText);
        } finally {
          this.isMutatingDOM = false;
        }
      }
    );
  }

  private dispatchSafeSubmit(inputEl: HTMLElement, sendBtn: HTMLElement | null): void {
    if (this.isSubmitting) return;
    this.isSubmitting = true;
    this.isBypassingInterceptor = true;

    // Wait requestAnimationFrame + 20ms setTimeout so live ProseMirror/React state has time to commit
    const rAF =
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (cb: FrameRequestCallback) => setTimeout(cb, 16);

    rAF(() => {
      setTimeout(() => {
        try {
          const activeBtn =
            (sendBtn && document.body && document.body.contains(sendBtn) && !sendBtn.hasAttribute('disabled') ? sendBtn : null) ||
            this.adapter.getSendButton();

          if (activeBtn) {
            (activeBtn as unknown as { __isPromptShieldBypass?: boolean }).__isPromptShieldBypass = true;
          }
          this.adapter.triggerSubmit(inputEl, activeBtn);
        } finally {
          this.isBypassingInterceptor = false;
          this.isSubmitting = false;
        }
      }, 20);
    });
  }

  private syncVaultWithBackground(newMappings: Record<string, string>): void {
    this.rehydrator.updateVault(newMappings);

    if (Object.keys(newMappings).length > 0 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage<ExtensionMessage<SyncVaultPayload>>({
        type: 'SYNC_VAULT',
        payload: {
          newMappings,
        },
      }).catch(() => {
        // Safe catch if background is inactive
      });
    }
  }

  public getSettings(): ExtensionSettings {
    return this.settings;
  }

  public setSettings(s: Partial<ExtensionSettings>): void {
    this.settings = this.mergeSettings(s);
  }

  public getRehydrator(): ResponseRehydrator {
    return this.rehydrator;
  }

  public getVault(): EntityVault {
    return this.vault;
  }
}

// Auto-instantiate when running in Chrome Extension content script context
if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  (typeof process === 'undefined' || process.env.NODE_ENV !== 'test')
) {
  const interceptor = new PromptInterceptor();
  interceptor.init().catch(console.error);
}
