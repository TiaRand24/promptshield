import { describe, expect, it } from 'vitest';
import {
  findCreditCardMatches,
  findCustomWordMatches,
  findEmailMatches,
  findIPMatches,
  findPhoneMatches,
  findSSNMatches,
  findSecretMatches,
  isValidIPv4,
  isValidIPv6,
  validateLuhn,
} from '../src/engine/regex-rules';
import { sanitizePrompt } from '../src/engine/sanitizer';
import { EntityVault, rehydrateText } from '../src/engine/vault';
import { ExtensionSettings } from '../src/types';

describe('Engine: Luhn & Rule Validators', () => {
  it('validates authentic credit card numbers and rejects invalid numbers via Luhn', () => {
    // Valid standard test cards
    expect(validateLuhn('4532 0151 1283 0366')).toBe(true);
    expect(validateLuhn('4111-1111-1111-1111')).toBe(true);
    expect(validateLuhn('4111111111111111')).toBe(true);
    expect(validateLuhn('378282246310005')).toBe(true); // Amex 15 digits

    // Invalid numbers
    expect(validateLuhn('4111 1111 1111 1112')).toBe(false); // bad check digit
    expect(validateLuhn('1234567890123456')).toBe(false);
    expect(validateLuhn('12345')).toBe(false); // too short
    expect(validateLuhn('123456789012345678901')).toBe(false); // too long
  });

  it('correctly filters loopback, local, and unspecified IP addresses', () => {
    expect(isValidIPv4('127.0.0.1')).toBe(false);
    expect(isValidIPv4('0.0.0.0')).toBe(false);
    expect(isValidIPv4('192.168.1.1')).toBe(false);
    expect(isValidIPv4('10.0.0.1')).toBe(false);
    expect(isValidIPv4('255.255.255.0')).toBe(false);
    expect(isValidIPv4('8.8.8.8')).toBe(true);
    expect(isValidIPv4('198.51.100.25')).toBe(true);
    expect(isValidIPv4('999.999.999.999')).toBe(false);

    expect(isValidIPv6('::1')).toBe(false);
    expect(isValidIPv6('0:0:0:0:0:0:0:0')).toBe(false);
    expect(isValidIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);

    const ipText = 'Host at 198.51.100.25 and 127.0.0.1 and 192.168.1.1';
    const matches = findIPMatches(ipText);
    expect(matches).toHaveLength(1);
    expect(matches[0].rawText).toBe('198.51.100.25');
  });

  it('detects API keys and secrets accurately', () => {
    const text = `
      AWS: AKIAIOSFODNN7EXAMPLE
      OpenAI: sk-proj-abc123def456ghi789jkl012mno345pqr678
      GitHub: ghp_1234567890abcdefghijklmnopqrstuvwxyzAB
      Slack: xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuv
      JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
      PEM:
      -----BEGIN RSA PRIVATE KEY-----
      MIIEowIBAAKCAQEA0Y3y
      -----END RSA PRIVATE KEY-----
    `;

    const matches = findSecretMatches(text);
    expect(matches.length).toBeGreaterThanOrEqual(6);
    expect(matches.some((m) => m.rawText.includes('AKIAIOSFODNN7EXAMPLE'))).toBe(true);
    expect(matches.some((m) => m.rawText.includes('sk-proj-abc123def456'))).toBe(true);
    expect(matches.some((m) => m.rawText.includes('ghp_1234567890abcdef'))).toBe(true);
    expect(matches.some((m) => m.rawText.includes('xoxb-123456789012'))).toBe(true);
    expect(matches.some((m) => m.rawText.includes('eyJhbGciOiJIUzI1Ni'))).toBe(true);
    expect(matches.some((m) => m.rawText.includes('BEGIN RSA PRIVATE KEY'))).toBe(true);
  });

  it('detects SSNs, phone numbers, and emails accurately', () => {
    const text = 'Contact Alice at alice.smith@enterprise.org, call 555-839-2019, SSN: 123-45-6789';
    const emailMatches = findEmailMatches(text);
    const phoneMatches = findPhoneMatches(text);
    const ssnMatches = findSSNMatches(text);

    expect(emailMatches).toHaveLength(1);
    expect(emailMatches[0].rawText).toBe('alice.smith@enterprise.org');

    expect(phoneMatches).toHaveLength(1);
    expect(phoneMatches[0].rawText).toBe('555-839-2019');

    expect(ssnMatches).toHaveLength(1);
    expect(ssnMatches[0].rawText).toBe('123-45-6789');
  });

  it('detects credit cards only if they pass Luhn algorithm', () => {
    const text = 'Valid: 4532 0151 1283 0366, Invalid: 4532 0151 1283 0367, Short: 12345';
    const ccMatches = findCreditCardMatches(text);
    expect(ccMatches).toHaveLength(1);
    expect(ccMatches[0].rawText).toBe('4532 0151 1283 0366');
  });

  it('detects custom words loaded from settings', () => {
    const text = 'Project Titan is confidential for client Acme Global.';
    const customMatches = findCustomWordMatches(text, ['Titan', 'Acme Global']);
    expect(customMatches).toHaveLength(2);
    expect(customMatches.map((m) => m.rawText)).toContain('Titan');
    expect(customMatches.map((m) => m.rawText)).toContain('Acme Global');
  });
});

describe('Engine: Vault and Sanitizer Pipeline', () => {
  it('guarantees idempotent and consistent tokenization for repeated entities', () => {
    const vault = new EntityVault();
    const prompt1 = 'Send email to bob@example.com. Again, bob@example.com is the lead.';
    const result1 = sanitizePrompt(prompt1, vault);

    expect(result1.sanitizedText).toBe(
      'Send email to [EMAIL_1]. Again, [EMAIL_1] is the lead.'
    );
    expect(result1.delta.totalEntitiesDetected).toBe(2);
    expect(Object.keys(result1.delta.newMappings)).toHaveLength(1);
    expect(result1.delta.newMappings['[EMAIL_1]']).toBe('bob@example.com');

    // Follow-up prompt with the same email and a new email
    const prompt2 = 'Also cc bob@example.com and charlie@example.com';
    const result2 = sanitizePrompt(prompt2, vault);

    expect(result2.sanitizedText).toBe(
      'Also cc [EMAIL_1] and [EMAIL_2]'
    );
    expect(result2.delta.newMappings['[EMAIL_2]']).toBe('charlie@example.com');
    // Ensure bob was reused, not re-allocated
    expect(result2.delta.newMappings['[EMAIL_1]']).toBeUndefined();
  });

  it('handles multi-entity prompts with proper token typing', () => {
    const vault = new EntityVault();
    const prompt =
      'Server 198.51.100.50 with key AKIAIOSFODNN7EXAMPLE and card 4532-0151-1283-0366 by user user@corp.io';
    const result = sanitizePrompt(prompt, vault);

    expect(result.sanitizedText).toContain('[IP_1]');
    expect(result.sanitizedText).toContain('[SECRET_1]');
    expect(result.sanitizedText).toContain('[CREDIT_CARD_1]');
    expect(result.sanitizedText).toContain('[EMAIL_1]');

    expect(result.hasModifications).toBe(true);
    expect(result.delta.totalEntitiesDetected).toBe(4);
  });

  it('resolves overlapping spans cleanly without corruption', () => {
    const vault = new EntityVault();
    // Suppose a custom word is "corp" while email is "admin@corp.com"
    const settings: ExtensionSettings = {
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
      customWords: ['corp'],
      rehydrateReplies: true,
    };

    const text = 'Contact admin@corp.com right now.';
    const result = sanitizePrompt(text, vault, settings);

    // Email has priority or length preference over partial custom word match inside domain
    expect(result.sanitizedText).toBe('Contact [EMAIL_1] right now.');
  });

  it('performs flawless round-trip rehydration', () => {
    const vault = new EntityVault();
    const original =
      'Deploy to 198.51.100.22 using token ghp_1234567890abcdefghijklmnopqrstuvwxyzAB. Notify support@cloud.net.';

    const sanitized = sanitizePrompt(original, vault);
    expect(sanitized.sanitizedText).not.toBe(original);

    const rehydrated = rehydrateText(
      sanitized.sanitizedText,
      vault.exportState().tokenToOriginal
    );

    expect(rehydrated).toBe(original);
  });

  it('respects rule toggles in settings', () => {
    const vault = new EntityVault();
    const text = 'Email: test@test.com, IP: 198.51.100.22';
    const settings: ExtensionSettings = {
      enabled: true,
      mode: 'auto',
      enabledRules: {
        EMAIL: false, // disabled
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

    const result = sanitizePrompt(text, vault, settings);
    // Email should NOT be sanitized, but IP should be
    expect(result.sanitizedText).toBe('Email: test@test.com, IP: [IP_1]');
  });
});
