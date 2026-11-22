import {
  ExtensionSettings,
  MatchedSpan,
  SanitizationResult,
  VaultDelta,
} from '../types';
import {
  findConnectionUriMatches,
  findCreditCardMatches,
  findCustomWordMatches,
  findEmailMatches,
  findIPMatches,
  findPasswordMatches,
  findPhoneMatches,
  findSSNMatches,
  findSecretMatches,
} from './regex-rules';
import { EntityVault } from './vault';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  mode: 'auto',
  enabledRules: {
    EMAIL: true,
    SECRET: true,
    CREDIT_CARD: true,
    SSN: true,
    PHONE: true,
    IP: true,
    CUSTOM: true,
    CONNECTION_URI: true,
    PASSWORD: true,
  },
  customWords: [],
  rehydrateReplies: true,
};

/**
 * Resolves overlapping spans prioritizing by:
 * 1. Longer span length (longer encompassing entity takes precedence over substrings)
 * 2. Higher rule priority
 * 3. Earlier starting position
 */
export function resolveOverlappingSpans(spans: MatchedSpan[]): MatchedSpan[] {
  if (spans.length <= 1) return spans;

  // Sort candidates by length DESC, priority DESC, start ASC
  const sorted = [...spans].sort((a, b) => {
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenB !== lenA) {
      return lenB - lenA;
    }
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return a.start - b.start;
  });

  const accepted: MatchedSpan[] = [];

  for (const candidate of sorted) {
    const hasOverlap = accepted.some(
      (acc) => candidate.start < acc.end && acc.start < candidate.end
    );
    if (!hasOverlap) {
      accepted.push(candidate);
    }
  }

  // Return spans in chronological order (start index ASC)
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Executes full sanitization pipeline on input text using the active vault and configuration.
 */
export function sanitizePrompt(
  rawText: string,
  vault: EntityVault,
  settings: ExtensionSettings = DEFAULT_SETTINGS
): SanitizationResult {
  if (!settings.enabled || !rawText || rawText.trim().length === 0) {
    return {
      originalText: rawText,
      sanitizedText: rawText,
      hasModifications: false,
      hasChanges: false,
      matchCount: 0,
      delta: {
        newMappings: {},
        totalEntitiesDetected: 0,
        entitiesByType: {
          EMAIL: 0,
          SECRET: 0,
          CREDIT_CARD: 0,
          SSN: 0,
          PHONE: 0,
          IP: 0,
          CUSTOM: 0,
          CONNECTION_URI: 0,
          PASSWORD: 0,
        },
      },
      spans: [],
    };
  }

  const rawSpans: MatchedSpan[] = [];

  if (settings.enabledRules.CONNECTION_URI) {
    rawSpans.push(...findConnectionUriMatches(rawText));
  }
  if (settings.enabledRules.SECRET) {
    rawSpans.push(...findSecretMatches(rawText));
  }
  if (settings.enabledRules.PASSWORD) {
    rawSpans.push(...findPasswordMatches(rawText));
  }
  if (settings.enabledRules.CUSTOM && settings.customWords.length > 0) {
    rawSpans.push(...findCustomWordMatches(rawText, settings.customWords));
  }
  if (settings.enabledRules.CREDIT_CARD) {
    rawSpans.push(...findCreditCardMatches(rawText));
  }
  if (settings.enabledRules.SSN) {
    rawSpans.push(...findSSNMatches(rawText));
  }
  if (settings.enabledRules.EMAIL) {
    rawSpans.push(...findEmailMatches(rawText));
  }
  if (settings.enabledRules.PHONE) {
    rawSpans.push(...findPhoneMatches(rawText));
  }
  if (settings.enabledRules.IP) {
    rawSpans.push(...findIPMatches(rawText));
  }

  const resolvedSpans = resolveOverlappingSpans(rawSpans);

  if (resolvedSpans.length === 0) {
    return {
      originalText: rawText,
      sanitizedText: rawText,
      hasModifications: false,
      hasChanges: false,
      matchCount: 0,
      delta: {
        newMappings: {},
        totalEntitiesDetected: 0,
        entitiesByType: {
          EMAIL: 0,
          SECRET: 0,
          CREDIT_CARD: 0,
          SSN: 0,
          PHONE: 0,
          IP: 0,
          CUSTOM: 0,
          CONNECTION_URI: 0,
          PASSWORD: 0,
        },
      },
      spans: [],
    };
  }

  const delta: VaultDelta = {
    newMappings: {},
    totalEntitiesDetected: resolvedSpans.length,
    entitiesByType: {
      EMAIL: 0,
      SECRET: 0,
      CREDIT_CARD: 0,
      SSN: 0,
      PHONE: 0,
      IP: 0,
      CUSTOM: 0,
      CONNECTION_URI: 0,
      PASSWORD: 0,
    },
  };

  let sanitizedText = '';
  let lastIndex = 0;

  for (const span of resolvedSpans) {
    // Append unchanged chunk
    sanitizedText += rawText.slice(lastIndex, span.start);

    // Retrieve or assign token in vault
    const { token, isNew } = vault.getOrCreateToken(span.rawText, span.tokenType);

    if (isNew) {
      delta.newMappings[token] = span.rawText;
    }
    delta.entitiesByType[span.tokenType] = (delta.entitiesByType[span.tokenType] || 0) + 1;

    sanitizedText += token;
    lastIndex = span.end;
  }

  // Append remaining text after last span
  sanitizedText += rawText.slice(lastIndex);
  const hasChanges = sanitizedText !== rawText;

  return {
    originalText: rawText,
    sanitizedText,
    hasModifications: hasChanges,
    hasChanges,
    matchCount: resolvedSpans.length,
    delta,
    spans: resolvedSpans,
  };
}
