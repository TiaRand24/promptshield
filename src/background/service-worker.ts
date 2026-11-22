import { DEFAULT_SETTINGS } from '../engine/sanitizer';
import {
  ExtensionMessage,
  ExtensionSettings,
  OffscreenAnalyzePayload,
  SyncVaultPayload,
} from '../types';

const STORAGE_KEY_SETTINGS = 'prompt_shield_settings';
const SESSION_KEY_VAULT = 'prompt_shield_session_vault';

/**
 * Ensures offscreen document exists if offscreen API is available
 */
async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.offscreen) return;

  const existingContexts = await chrome.runtime.getContexts?.({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts && existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS || chrome.offscreen.Reason.DOM_SCRAPING],
    justification: 'Local NER and entity tokenization analysis in sandboxed worker',
  });
}

/**
 * Loads extension settings from chrome.storage.local
 */
async function getSettings(): Promise<ExtensionSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_SETTINGS;
  }

  const data = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
  if (data && data[STORAGE_KEY_SETTINGS]) {
    return {
      ...DEFAULT_SETTINGS,
      ...data[STORAGE_KEY_SETTINGS],
    };
  }
  return DEFAULT_SETTINGS;
}

/**
 * Saves extension settings to chrome.storage.local and notifies tabs
 */
async function saveSettings(settings: ExtensionSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });

  // Broadcast to all active tabs
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'UPDATE_SETTINGS',
        payload: settings,
      }).catch(() => {});
    }
  }
}

/**
 * Retrieves the ephemeral session vault from chrome.storage.session
 */
async function getSessionVault(): Promise<Record<string, string>> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return {};
  }
  const data = await chrome.storage.session.get(SESSION_KEY_VAULT);
  return (data?.[SESSION_KEY_VAULT] as Record<string, string>) || {};
}

/**
 * Merges new token mappings into chrome.storage.session
 */
async function syncSessionVault(newMappings: Record<string, string>): Promise<Record<string, string>> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return newMappings;
  }
  const current = await getSessionVault();
  const updated = { ...current, ...newMappings };
  await chrome.storage.session.set({ [SESSION_KEY_VAULT]: updated });
  return updated;
}

/**
 * Clears the ephemeral session vault and notifies all tabs
 */
async function clearSessionVault(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return;

  await chrome.storage.session.remove(SESSION_KEY_VAULT);

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'CLEAR_VAULT',
      }).catch(() => {});
    }
  }
}

// Extension message listener
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'GET_SETTINGS': {
            const settings = await getSettings();
            sendResponse(settings);
            break;
          }
          case 'UPDATE_SETTINGS': {
            if (message.payload) {
              await saveSettings(message.payload as ExtensionSettings);
            }
            sendResponse({ success: true });
            break;
          }
          case 'GET_VAULT': {
            const vault = await getSessionVault();
            sendResponse(vault);
            break;
          }
          case 'SYNC_VAULT': {
            const payload = message.payload as SyncVaultPayload;
            if (payload?.newMappings) {
              const updated = await syncSessionVault(payload.newMappings);
              sendResponse(updated);
            } else {
              sendResponse({});
            }
            break;
          }
          case 'CLEAR_VAULT': {
            await clearSessionVault();
            sendResponse({ success: true });
            break;
          }
          case 'OFFSCREEN_ANALYZE': {
            await ensureOffscreenDocument();
            const payload = message.payload as OffscreenAnalyzePayload;
            // Send to offscreen document
            const response = await chrome.runtime.sendMessage({
              type: 'OFFSCREEN_ANALYZE_INTERNAL',
              payload,
            });
            sendResponse(response);
            break;
          }
          default:
            sendResponse({ error: 'Unknown message type' });
        }
      } catch (err: unknown) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
    })();

    // Keep message channel open for async response
    return true;
  });
}
