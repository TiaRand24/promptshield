import { TokenType, VaultState } from '../types';

export class EntityVault {
  private tokenToOriginal: Map<string, string> = new Map();
  private originalToToken: Map<string, string> = new Map();
  private categoryCounters: Record<TokenType, number> = {
    EMAIL: 0,
    SECRET: 0,
    CREDIT_CARD: 0,
    SSN: 0,
    PHONE: 0,
    IP: 0,
    CUSTOM: 0,
    CONNECTION_URI: 0,
    PASSWORD: 0,
  };

  constructor(initialState?: Partial<VaultState>) {
    if (initialState) {
      this.loadState(initialState);
    }
  }

  /**
   * Loads a serialized vault state.
   */
  public loadState(state: Partial<VaultState>): void {
    if (state.tokenToOriginal) {
      for (const [token, original] of Object.entries(state.tokenToOriginal)) {
        this.tokenToOriginal.set(token, original);
      }
    }
    if (state.originalToToken) {
      for (const [original, token] of Object.entries(state.originalToToken)) {
        this.originalToToken.set(original, token);
      }
    }
    if (state.categoryCounters) {
      this.categoryCounters = {
        ...this.categoryCounters,
        ...state.categoryCounters,
      };
    }
  }

  /**
   * Retrieves an existing token for an entity, or generates a new one.
   * Ensures idempotency: identical entities always receive the exact same token.
   */
  public getOrCreateToken(rawText: string, tokenType: TokenType): { token: string; isNew: boolean } {
    // Normalization key for lookup:
    // Emails and IPs are case-insensitive
    const lookupKey = tokenType === 'EMAIL' || tokenType === 'IP' ? rawText.toLowerCase() : rawText;

    const existingToken = this.originalToToken.get(lookupKey);
    if (existingToken) {
      return { token: existingToken, isNew: false };
    }

    // Allocate next token number for this type
    this.categoryCounters[tokenType] = (this.categoryCounters[tokenType] || 0) + 1;
    const count = this.categoryCounters[tokenType];
    const token = `[${tokenType}_${count}]`;

    this.tokenToOriginal.set(token, rawText);
    this.originalToToken.set(lookupKey, token);

    return { token, isNew: true };
  }

  /**
   * Look up original value by token
   */
  public getOriginal(token: string): string | undefined {
    return this.tokenToOriginal.get(token);
  }

  /**
   * Export vault as state object for chrome.storage
   */
  public exportState(): VaultState {
    const tokenToOriginalObj: Record<string, string> = {};
    for (const [k, v] of this.tokenToOriginal.entries()) {
      tokenToOriginalObj[k] = v;
    }

    const originalToTokenObj: Record<string, string> = {};
    for (const [k, v] of this.originalToToken.entries()) {
      originalToTokenObj[k] = v;
    }

    return {
      tokenToOriginal: tokenToOriginalObj,
      originalToToken: originalToTokenObj,
      categoryCounters: { ...this.categoryCounters },
    };
  }

  /**
   * Reset all stored mappings
   */
  public clear(): void {
    this.tokenToOriginal.clear();
    this.originalToToken.clear();
    for (const key of Object.keys(this.categoryCounters) as TokenType[]) {
      this.categoryCounters[key] = 0;
    }
  }

  /**
   * Number of stored tokens
   */
  public size(): number {
    return this.tokenToOriginal.size;
  }
}

/**
 * Replaces token placeholders like `[EMAIL_1]` or `[SECRET_1]` back with their original values.
 * Safe against regex injection by escaping token keys.
 */
export function rehydrateText(text: string, vaultMap: Record<string, string>): string {
  if (!text || !vaultMap || Object.keys(vaultMap).length === 0) {
    return text;
  }

  let result = text;
  // Sort tokens by descending length to prevent partial prefix replacements
  const tokens = Object.keys(vaultMap).sort((a, b) => b.length - a.length);

  for (const token of tokens) {
    const original = vaultMap[token];
    if (original !== undefined) {
      // Literal split-join replacement is faster and immune to regex escaping issues
      result = result.split(token).join(original);
    }
  }

  return result;
}
