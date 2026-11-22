export type TokenType =
  | 'EMAIL'
  | 'SECRET'
  | 'CREDIT_CARD'
  | 'SSN'
  | 'PHONE'
  | 'IP'
  | 'CUSTOM'
  | 'CONNECTION_URI'
  | 'PASSWORD';

export interface RuleDefinition {
  id: string;
  name: string;
  type: TokenType;
  enabled: boolean;
  description: string;
}

export interface MatchedSpan {
  start: number;
  end: number;
  rawText: string;
  tokenType: TokenType;
  priority: number;
}

export interface VaultState {
  tokenToOriginal: Record<string, string>;
  originalToToken: Record<string, string>;
  categoryCounters: Record<TokenType, number>;
}

export interface VaultDelta {
  newMappings: Record<string, string>;
  totalEntitiesDetected: number;
  entitiesByType: Record<TokenType, number>;
}

export interface SanitizationResult {
  originalText: string;
  sanitizedText: string;
  hasModifications: boolean;
  hasChanges: boolean;
  matchCount: number;
  delta: VaultDelta;
  spans: MatchedSpan[];
}

export type InterceptorMode = 'auto' | 'review';

export interface ExtensionSettings {
  enabled: boolean;
  mode: InterceptorMode;
  enabledRules: Record<TokenType, boolean>;
  customWords: string[];
  rehydrateReplies: boolean;
}

export type MessageType =
  | 'GET_VAULT'
  | 'SYNC_VAULT'
  | 'CLEAR_VAULT'
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'OFFSCREEN_ANALYZE';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface SyncVaultPayload {
  newMappings: Record<string, string>;
  categoryCounters?: Record<TokenType, number>;
}

export interface OffscreenAnalyzePayload {
  text: string;
}
