import { DEFAULT_SETTINGS } from '../engine/sanitizer';
import { ExtensionMessage, ExtensionSettings, TokenType } from '../types';

let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };

const masterToggle = document.getElementById('master-toggle') as HTMLInputElement;
const modeAutoBtn = document.getElementById('mode-auto') as HTMLButtonElement;
const modeReviewBtn = document.getElementById('mode-review') as HTMLButtonElement;
const customWordsInput = document.getElementById('custom-words') as HTMLTextAreaElement;
const rehydrateToggle = document.getElementById('rehydrate-toggle') as HTMLInputElement;
const vaultList = document.getElementById('vault-list') as HTMLDivElement;
const vaultCount = document.getElementById('vault-count') as HTMLSpanElement;
const clearVaultBtn = document.getElementById('btn-clear-vault') as HTMLButtonElement;

const ruleKeys: TokenType[] = [
  'EMAIL',
  'SECRET',
  'CREDIT_CARD',
  'SSN',
  'PHONE',
  'IP',
  'CUSTOM',
  'CONNECTION_URI',
  'PASSWORD',
];

async function initPopup(): Promise<void> {
  // Load settings
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const settings = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionSettings>({
        type: 'GET_SETTINGS',
      });
      if (settings) {
        currentSettings = settings;
      }

      // Load session vault
      const vault = await chrome.runtime.sendMessage<ExtensionMessage, Record<string, string>>({
        type: 'GET_VAULT',
      });
      renderVault(vault || {});
    }
  } catch {
    // Fallback for standalone/mock preview
  }

  renderSettings();
  attachListeners();
}

function renderSettings(): void {
  masterToggle.checked = currentSettings.enabled;

  if (currentSettings.mode === 'auto') {
    modeAutoBtn.classList.add('active');
    modeReviewBtn.classList.remove('active');
  } else {
    modeReviewBtn.classList.add('active');
    modeAutoBtn.classList.remove('active');
  }

  for (const key of ruleKeys) {
    const el = document.getElementById(`rule-${key}`) as HTMLInputElement | null;
    if (el) {
      el.checked = !!currentSettings.enabledRules[key];
    }
  }

  customWordsInput.value = currentSettings.customWords.join(', ');
  rehydrateToggle.checked = currentSettings.rehydrateReplies;
}

function renderVault(vaultMap: Record<string, string>): void {
  const entries = Object.entries(vaultMap);
  vaultCount.textContent = `${entries.length} items`;

  if (entries.length === 0) {
    vaultList.innerHTML = '<div class="empty-vault">No active tokens in this session</div>';
    return;
  }

  vaultList.innerHTML = '';
  for (const [token, original] of entries) {
    const item = document.createElement('div');
    item.className = 'vault-item';

    const tokenSpan = document.createElement('span');
    tokenSpan.className = 'vault-token';
    tokenSpan.textContent = token;

    const valSpan = document.createElement('span');
    valSpan.className = 'vault-value';
    valSpan.textContent = original;
    valSpan.title = original;

    item.appendChild(tokenSpan);
    item.appendChild(valSpan);
    vaultList.appendChild(item);
  }
}

async function persistSettings(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    await chrome.runtime.sendMessage<ExtensionMessage<ExtensionSettings>>({
      type: 'UPDATE_SETTINGS',
      payload: currentSettings,
    });
  }
}

function attachListeners(): void {
  masterToggle.addEventListener('change', () => {
    currentSettings.enabled = masterToggle.checked;
    persistSettings();
  });

  modeAutoBtn.addEventListener('click', () => {
    currentSettings.mode = 'auto';
    renderSettings();
    persistSettings();
  });

  modeReviewBtn.addEventListener('click', () => {
    currentSettings.mode = 'review';
    renderSettings();
    persistSettings();
  });

  for (const key of ruleKeys) {
    const el = document.getElementById(`rule-${key}`) as HTMLInputElement | null;
    el?.addEventListener('change', () => {
      currentSettings.enabledRules[key] = el.checked;
      persistSettings();
    });
  }

  customWordsInput.addEventListener('change', () => {
    const words = customWordsInput.value
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
    currentSettings.customWords = words;
    persistSettings();
  });

  rehydrateToggle.addEventListener('change', () => {
    currentSettings.rehydrateReplies = rehydrateToggle.checked;
    persistSettings();
  });

  clearVaultBtn.addEventListener('click', async () => {
    if (confirm('Clear all session tokens? Any rehydration in ongoing chats will be disabled.')) {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage<ExtensionMessage>({ type: 'CLEAR_VAULT' });
        renderVault({});
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initPopup);
