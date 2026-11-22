import { OffscreenAnalyzePayload } from '../types';

/**
 * Offscreen Sandboxed Execution Context.
 * Used for high-compute local tasks (e.g. WASM / Web Worker tokenizers / local model NER)
 * with zero remote network calls.
 */
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'OFFSCREEN_ANALYZE_INTERNAL') {
      const payload = message.payload as OffscreenAnalyzePayload;
      const text = payload?.text || '';

      // Perform local analysis stub (extendable to ONNX Runtime Web / Transformers.js locally bundled)
      const tokenCountEstimate = text.split(/\s+/).filter(Boolean).length;

      sendResponse({
        success: true,
        wordCount: tokenCountEstimate,
        sanitizedLocally: true,
      });
    }
    return true;
  });
}
