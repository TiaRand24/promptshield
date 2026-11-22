import { MatchedSpan, TokenType } from '../types';

/**
 * Validates a credit card number using the Luhn checksum algorithm (Mod 10).
 */
export function validateLuhn(numStr: string): boolean {
  const sanitized = numStr.replace(/\D/g, '');
  if (sanitized.length < 13 || sanitized.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = sanitized.length - 1; i >= 0; i--) {
    let digit = parseInt(sanitized.charAt(i), 10);
    if (isNaN(digit)) return false;

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/**
 * Validates IPv4 address string and excludes loopback/unspecified as well as
 * local/documentation/broadcast ranges (192.168.*, 10.*, 255.255.255.*).
 */
export function isValidIPv4(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return false;
  // Exclude common non-sensitive local / documentation / broadcast ranges
  if (
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('255.255.255.')
  ) {
    return false;
  }

  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = parseInt(part, 10);
    if (num < 0 || num > 255) return false;
    // Disallow leading zeros unless the number itself is '0'
    if (part.length > 1 && part.startsWith('0')) return false;
  }
  return true;
}

/**
 * Validates IPv6 address string and excludes loopback/unspecified.
 */
export function isValidIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:0' ||
    normalized === '::'
  ) {
    return false;
  }
  // Standard IPv6 check
  const ipv6Pattern =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|:([0-9a-fA-F]{1,4}:){1,7}|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})$/;
  return ipv6Pattern.test(ip);
}

export interface RuleMatcher {
  id: string;
  type: TokenType;
  priority: number;
  findMatches: (text: string) => MatchedSpan[];
}

/**
 * Pre-compiled regex patterns for deterministic detectors
 */
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// High-Value Secret Patterns
const AWS_KEY_REGEX = /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g;
const OPENAI_KEY_REGEX = /\bsk-[-a-zA-Z0-9_]{20,}\b/g;
const ANTHROPIC_KEY_REGEX = /\bsk-ant-[-a-zA-Z0-9_]{20,}\b/g;
const GOOGLE_AI_KEY_REGEX = /\bAIza[-0-9A-Za-z_]{35,}\b/g;
const STRIPE_KEY_REGEX = /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g;
const GITHUB_PAT_REGEX = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g;
const GITHUB_FINE_GRAINED_PAT_REGEX = /\bgithub_pat_[a-zA-Z0-9_]{22,}\b/g;
const SLACK_TOKEN_REGEX = /\bxox[baprs]-[-0-9a-zA-Z]{10,}\b/g;
const JWT_TOKEN_REGEX = /\beyJ[-a-zA-Z0-9_]{10,}\.eyJ[-a-zA-Z0-9_]{10,}\.[-a-zA-Z0-9_]{10,}\b/g;
const PEM_PRIVATE_KEY_REGEX =
  /-----BEGIN (?:(?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?-----END (?:(?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g;
const GENERIC_API_KEY_REGEX =
  /\b(?:(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|aws_access_key_id|aws_secret_access_key)[\s:=]+|(?:authorization|proxy-authorization)\s*:\s*bearer\s+)['"]?([a-zA-Z0-9_\-/.+=]{16,})['"]?/gi;

// Connection Strings (URIs with credentials)
const CONNECTION_URI_REGEX = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^/\s:@]+:[^/\s@]+@[^\s"'`<>]+/gi;

// Inline Password / Secret Assignments
const PASSWORD_ASSIGNMENT_REGEX = /(?:\b(?:password|passwd|pwd|api_secret|client_secret|access_token)|"(?:password|passwd|pwd|api_secret|client_secret|access_token)")\s*[:=]\s*(['"]?)([^\s"',;}{]{6,})\1/gi;

// Credit Cards: 13-19 digits, possibly separated by spaces or hyphens
const CREDIT_CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

// US SSN
const SSN_REGEX = /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;

// Phone: US and standard international formats with delimiters (excludes raw numbers like Unix timestamps)
const PHONE_REGEX = /(?<!\d)(?:\+?1[-.\s]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[-.\s][2-9]\d{2}[-.\s]\d{4}(?!\d)/g;

// IPv4 and IPv6
const IPV4_CANDIDATE_REGEX = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
const IPV6_CANDIDATE_REGEX = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g;

export function findEmailMatches(text: string): MatchedSpan[] {
  const matches: MatchedSpan[] = [];
  const regex = new RegExp(EMAIL_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      rawText: match[0],
      tokenType: 'EMAIL',
      priority: 80,
    });
  }
  return matches;
}

export function findSecretMatches(text: string): MatchedSpan[] {
  const matches: MatchedSpan[] = [];

  const secretPatterns = [
    { regex: AWS_KEY_REGEX, name: 'AWS_KEY', priority: 100 },
    { regex: OPENAI_KEY_REGEX, name: 'OPENAI_KEY', priority: 100 },
    { regex: ANTHROPIC_KEY_REGEX, name: 'ANTHROPIC_KEY', priority: 100 },
    { regex: GOOGLE_AI_KEY_REGEX, name: 'GOOGLE_AI_KEY', priority: 100 },
    { regex: STRIPE_KEY_REGEX, name: 'STRIPE_KEY', priority: 100 },
    { regex: GITHUB_PAT_REGEX, name: 'GITHUB_PAT', priority: 100 },
    { regex: GITHUB_FINE_GRAINED_PAT_REGEX, name: 'GITHUB_FINE_GRAINED_PAT', priority: 100 },
    { regex: SLACK_TOKEN_REGEX, name: 'SLACK_TOKEN', priority: 100 },
    { regex: JWT_TOKEN_REGEX, name: 'JWT', priority: 95 },
    { regex: PEM_PRIVATE_KEY_REGEX, name: 'PEM_KEY', priority: 100 },
  ];

  for (const { regex, priority } of secretPatterns) {
    const rx = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        rawText: match[0],
        tokenType: 'SECRET',
        priority,
      });
    }
  }

  // Generic key-value secret matches
  const genericRx = new RegExp(GENERIC_API_KEY_REGEX.source, GENERIC_API_KEY_REGEX.flags);
  let genMatch: RegExpExecArray | null;
  while ((genMatch = genericRx.exec(text)) !== null) {
    let rawVal = genMatch[1];
    if (rawVal) {
      if (rawVal.endsWith('.') && !rawVal.includes('..')) {
        rawVal = rawVal.slice(0, -1);
      }
      if (rawVal.length >= 16) {
        const valueStartIndex = genMatch.index + genMatch[0].lastIndexOf(rawVal);
        matches.push({
          start: valueStartIndex,
          end: valueStartIndex + rawVal.length,
          rawText: rawVal,
          tokenType: 'SECRET',
          priority: 90,
        });
      }
    }
  }

  return matches;
}

export function findConnectionUriMatches(text: string): MatchedSpan[] {
  const matches: MatchedSpan[] = [];
  const rx = new RegExp(CONNECTION_URI_REGEX.source, CONNECTION_URI_REGEX.flags);
  let match: RegExpExecArray | null;
  while ((match = rx.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      rawText: match[0],
      tokenType: 'CONNECTION_URI',
      priority: 95,
    });
  }
  return matches;
}

export function findPasswordMatches(text: string): MatchedSpan[] {
  const matches: MatchedSpan[] = [];
  const rx = new RegExp(PASSWORD_ASSIGNMENT_REGEX.source, PASSWORD_ASSIGNMENT_REGEX.flags);
  let match: RegExpExecArray | null;

  const EXCLUDED_VALUES = new Set([
    'string',
    'number',
    'boolean',
    'varchar',
    'character',
    'unknown',
    'undefined',
    'null',
  ]);

  while ((match = rx.exec(text)) !== null) {
    const val = match[2];
    if (!val) continue;

    // Skip if already tokenized
    if (/^\[[A-Z_]+_\d+\]$/.test(val)) continue;

    // Skip common programming type annotations
    if (EXCLUDED_VALUES.has(val.toLowerCase())) continue;

    const valueStartIndex = match.index + match[0].lastIndexOf(val);
    matches.push({
      start: valueStartIndex,
      end: valueStartIndex + val.length,
      rawText: val,
      tokenType: 'PASSWORD',
      priority: 90,
    });
  }

  return matches;
}

export function findCreditCardMatches(text: string): MatchedSpan[] {
  const matches: MatchedSpan[] = [];
  const regex = new RegExp(CREDIT_CARD_CANDIDATE_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const candidate = match[0].trim();
    if (validateLuhn(candidate)) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        rawText: match[0],
        tokenType: 'CREDIT_CARD',
        priority: 85,
      });
    }
  }
  return matches;
}

export function findSSNMatches(text: string): MatchedSpan[] {
  const matches: MatchedSpan[] = [];
  const regex = new RegExp(SSN_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      rawText: match[0],
      tokenType: 'SSN',
      priority: 85,
    });
  }
  return matches;
}

export function findPhoneMatches(text: string): MatchedSpan[] {
  const matches: MatchedSpan[] = [];
  const regex = new RegExp(PHONE_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      rawText: match[0],
      tokenType: 'PHONE',
      priority: 75,
    });
  }
  return matches;
}

export function findIPMatches(text: string): MatchedSpan[] {
  const matches: MatchedSpan[] = [];

  // IPv4
  const ipv4Regex = new RegExp(IPV4_CANDIDATE_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = ipv4Regex.exec(text)) !== null) {
    const ip = match[0];
    const startIndex = match.index;
    const endIndex = match.index + ip.length;

    // Guard against version strings like v1.2.3.4 or .1.2.3.4
    if (startIndex > 0) {
      const prevChar = text.charAt(startIndex - 1);
      if (prevChar === 'v' || prevChar === 'V' || prevChar === '.') {
        continue;
      }
    }
    // Guard against extended version strings or OIDs like 1.2.3.4.5
    if (endIndex < text.length) {
      const nextChar = text.charAt(endIndex);
      if (nextChar === '.') {
        continue;
      }
    }

    if (isValidIPv4(ip)) {
      matches.push({
        start: startIndex,
        end: endIndex,
        rawText: ip,
        tokenType: 'IP',
        priority: 70,
      });
    }
  }

  // IPv6
  const ipv6Regex = new RegExp(IPV6_CANDIDATE_REGEX.source, 'g');
  while ((match = ipv6Regex.exec(text)) !== null) {
    const ip = match[0];
    if (isValidIPv6(ip)) {
      matches.push({
        start: match.index,
        end: match.index + ip.length,
        rawText: ip,
        tokenType: 'IP',
        priority: 70,
      });
    }
  }

  return matches;
}

export function findCustomWordMatches(
  text: string,
  customWords: string[]
): MatchedSpan[] {
  if (!customWords || customWords.length === 0) return [];

  const validWords = customWords
    .map((w) => w.trim())
    .filter((w) => w.length > 0);

  if (validWords.length === 0) return [];

  const matches: MatchedSpan[] = [];
  // Sort words by descending length to match longest terms first
  const sortedWords = [...validWords].sort((a, b) => b.length - a.length);

  for (const word of sortedWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word boundary check where applicable
    const isAlphanumeric = /^\w+$/.test(word);
    const pattern = isAlphanumeric ? `\\b${escaped}\\b` : escaped;
    const regex = new RegExp(pattern, 'gi');

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        rawText: match[0],
        tokenType: 'CUSTOM',
        priority: 95,
      });
    }
  }

  return matches;
}
