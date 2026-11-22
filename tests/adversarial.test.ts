import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptInterceptor } from '../src/content/interceptor';
import { UIOverlay } from '../src/content/ui-overlay';
import { sanitizePrompt } from '../src/engine/sanitizer';
import { EntityVault } from '../src/engine/vault';

describe('Task 3: Adversarial Test Suite', () => {
  let activeInterceptor: PromptInterceptor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    activeInterceptor?.destroy();
    activeInterceptor = null;
    vi.restoreAllMocks();
  });

  // --- Category 1: Repeat Prompt Counter & Vault Tests ---

  it('1. Repeat Prompt Counter Test: accurately returns matchCount = 2 and hasChanges = true on existing vault entities', () => {
    const vault = new EntityVault();

    // 1st prompt: introduces dev@acme.io
    const firstResult = sanitizePrompt('Contact dev@acme.io', vault);
    expect(firstResult.hasChanges).toBe(true);
    expect(firstResult.matchCount).toBe(1);
    expect(firstResult.sanitizedText).toBe('Contact [EMAIL_1]');
    expect(firstResult.delta.newMappings['[EMAIL_1]']).toBe('dev@acme.io');

    // 2nd prompt: reuses dev@acme.io AND introduces a new OpenAI key
    const secondPrompt =
      'Follow up with dev@acme.io and sk-proj-1234567890abcdef1234567890abcdef';
    const secondResult = sanitizePrompt(secondPrompt, vault);

    expect(secondResult.hasChanges).toBe(true);
    // MUST be 2 (dev@acme.io + sk-proj...), NOT 0 or 1!
    expect(secondResult.matchCount).toBe(2);
    expect(secondResult.sanitizedText).toBe(
      'Follow up with [EMAIL_1] and [SECRET_1]'
    );
    // Only the new secret should be in newMappings delta for background sync
    expect(Object.keys(secondResult.delta.newMappings)).toHaveLength(1);
    expect(secondResult.delta.newMappings['[SECRET_1]']).toBe(
      'sk-proj-1234567890abcdef1234567890abcdef'
    );
  });

  it('2. Repeat Entity Prompt: handles prompt containing only pre-existing vault entities with non-zero matchCount', () => {
    const vault = new EntityVault();
    sanitizePrompt('Key: AKIAIOSFODNN7EXAMPLE and email user@corp.internal', vault);

    // Second prompt containing solely previously seen secrets
    const repeatOnly = 'Ping user@corp.internal regarding key AKIAIOSFODNN7EXAMPLE';
    const res = sanitizePrompt(repeatOnly, vault);

    expect(res.hasChanges).toBe(true);
    expect(res.matchCount).toBe(2);
    expect(res.sanitizedText).toBe('Ping [EMAIL_1] regarding key [SECRET_1]');
    // newMappings is empty because no new tokens were generated, but matchCount is 2
    expect(Object.keys(res.delta.newMappings)).toHaveLength(0);
  });

  // --- Category 2: Real-World Developer Prompts ---

  it('3. Real-World Developer Prompt: sanitizes complete .env file snippet', () => {
    const vault = new EntityVault();
    const envFile = `
DATABASE_URL=postgresql://admin:supersecret123@db.internal.net:5432/prod
STRIPE_KEY=sk_live_51Nx1234567890abcdefghijklmnopqrstuv
ADMIN_EMAIL=cto@startup.io
APP_PORT=3000
    `.trim();

    const result = sanitizePrompt(envFile, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(3);

    expect(result.sanitizedText).toContain('DATABASE_URL=[CONNECTION_URI_1]');
    expect(result.sanitizedText).toContain('STRIPE_KEY=[SECRET_1]');
    expect(result.sanitizedText).toContain('ADMIN_EMAIL=[EMAIL_1]');
    expect(result.sanitizedText).toContain('APP_PORT=3000');

    expect(result.sanitizedText).not.toContain('supersecret123');
    expect(result.sanitizedText).not.toContain('sk_live_51Nx');
    expect(result.sanitizedText).not.toContain('cto@startup.io');
  });

  it('4. Real-World Connection Strings: sanitizes MongoDB, MySQL, and Redis URIs with credentials', () => {
    const vault = new EntityVault();
    const uris = `
mongodb+srv://dbuser:m0ng0p@ss!@cluster0.abcde.mongodb.net/test?retryWrites=true
mysql://appuser:db_password_999@mysql-primary.internal:3306/production
redis://default:redispw_xyz123@cache.internal:6379
amqp://guest:secretguestpass@rabbitmq.infra:5672
    `.trim();

    const result = sanitizePrompt(uris, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(4);
    expect(result.sanitizedText).toContain('[CONNECTION_URI_1]');
    expect(result.sanitizedText).toContain('[CONNECTION_URI_2]');
    expect(result.sanitizedText).toContain('[CONNECTION_URI_3]');
    expect(result.sanitizedText).toContain('[CONNECTION_URI_4]');
    expect(result.sanitizedText).not.toContain('m0ng0p@ss!');
    expect(result.sanitizedText).not.toContain('db_password_999');
    expect(result.sanitizedText).not.toContain('redispw_xyz123');
  });

  it('5. Real-World JSON Payload: sanitizes Bearer JWT, password field, and customer email', () => {
    const vault = new EntityVault();
    const jsonPayload = JSON.stringify(
      {
        authorization:
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvZSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        user: {
          email: 'customer.support@acme-corp.com',
          password: 'MyS3cretP@ss!',
        },
      },
      null,
      2
    );

    const result = sanitizePrompt(jsonPayload, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(3);
    expect(result.sanitizedText).toContain('Bearer [SECRET_1]');
    expect(result.sanitizedText).toContain('"email": "[EMAIL_1]"');
    expect(result.sanitizedText).toContain('"password": "[PASSWORD_1]"');
    expect(result.sanitizedText).not.toContain('MyS3cretP@ss!');
    expect(result.sanitizedText).not.toContain('customer.support@acme-corp.com');
  });

  it('6. Inline Password Assignments: sanitizes password, api_secret, and client_secret in config blocks', () => {
    const vault = new EntityVault();
    const config = `
password = supersecret_value_123
api_secret: "api_sec_abcdef987654"
client_secret="oauth_secret_val_xyz"
    `.trim();

    const result = sanitizePrompt(config, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(3);
    expect(result.sanitizedText).toBe(
      'password = [PASSWORD_1]\napi_secret: "[PASSWORD_2]"\nclient_secret="[PASSWORD_3]"'
    );
  });

  it('7. High-Value AI & SaaS Keys: detects Anthropic, Google AI, Stripe, and GitHub PATs', () => {
    const vault = new EntityVault();
    const keys = `
Anthropic: sk-ant-api03-abcdef1234567890abcdefghijklmnopqrstuvwxyz1234
Google AI: AIzaSyA1234567890abcdefghijklmnopqrstuvw
Stripe: sk_live_51Nx1234567890abcdefghijklmnopqrstuv
GitHub: ghp_1234567890abcdefghijklmnopqrstuvwxyzAB and github_pat_11A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7
Slack: xoxb-1234567890-abcdef123456
    `.trim();

    const result = sanitizePrompt(keys, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(6);
    expect(result.sanitizedText).not.toContain('sk-ant-api03');
    expect(result.sanitizedText).not.toContain('AIzaSyA');
    expect(result.sanitizedText).not.toContain('sk_live_51Nx');
    expect(result.sanitizedText).not.toContain('ghp_1234567890');
    expect(result.sanitizedText).not.toContain('github_pat_11A2B3');
  });

  it('8. Gemini DOM Integration: verifies multi-line Quill contenteditable prompt tokenizes and UI overlay receives correct non-zero count', () => {
    document.body.innerHTML = `
      <div id="gemini-container">
        <div class="ql-editor" contenteditable="true">
          <p>Debug my Postgres database connection: postgresql://admin:prodsecret99@db.prod.internal:5432/app</p>
          <p>And check access token sk-proj-1234567890abcdef1234567890abcdef</p>
        </div>
        <button aria-label="Send message" type="button">Send</button>
      </div>
    `;

    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const editor = document.querySelector('div.ql-editor') as HTMLElement;
    const sendBtn = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement;

    const overlay = (activeInterceptor as unknown as { overlay: UIOverlay }).overlay;
    const showPillSpy = vi.spyOn(overlay, 'showAutoSanitizedPill');

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    sendBtn.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(editor.textContent).toContain('[CONNECTION_URI_1]');
    expect(editor.textContent).toContain('[SECRET_1]');
    expect(editor.textContent).not.toContain('prodsecret99');
    expect(editor.textContent).not.toContain('sk-proj-1234567890abcdef');

    // UI Overlay must receive exactly 2, NEVER 0!
    expect(showPillSpy).toHaveBeenCalledTimes(1);
    expect(showPillSpy).toHaveBeenCalledWith(2, expect.any(Function));
  });

  // --- Category 3: UI Overlay & DOM Mutation Guards ---

  it('9. UIOverlay Guard: show(0) and showAutoSanitizedPill(0) return immediately and never render DOM or overwrite active pill', () => {
    const overlay = new UIOverlay();

    // Showing 2 secrets first
    overlay.show(2);
    const host = document.getElementById('prompt-shield-overlay-root');
    expect(host).not.toBeNull();
    const shadow = host?.shadowRoot;
    expect(shadow?.querySelector('.shield-pill')?.textContent).toContain('2 secrets tokenized');

    // Calling show(0) or showAutoSanitizedPill(0) should be a no-op and NOT overwrite the pill with 0
    overlay.show(0);
    overlay.showAutoSanitizedPill(0);

    expect(shadow?.querySelector('.shield-pill')?.textContent).toContain('2 secrets tokenized');
    expect(shadow?.querySelector('.shield-pill')?.textContent).not.toContain('0');
  });

  it('10. Interceptor DOM Mutation Lock: ignores self-triggered synthetic events and prevents recursive pill flashing', () => {
    document.body.innerHTML = `
      <form>
        <textarea id="prompt-textarea"></textarea>
        <button id="send-button" type="submit">Send</button>
      </form>
    `;

    activeInterceptor = new PromptInterceptor();
    activeInterceptor.attachEventListeners();

    const textarea = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    textarea.value = 'Deploy with key AKIAIOSFODNN7EXAMPLE';

    const overlay = (activeInterceptor as unknown as { overlay: UIOverlay }).overlay;
    const showSpy = vi.spyOn(overlay, 'showAutoSanitizedPill');

    // Simulate Enter submission
    const enterEv = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.dispatchEvent(enterEv);

    expect(enterEv.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('Deploy with key [SECRET_1]');

    // Overlay was shown once with count 1
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(showSpy).toHaveBeenCalledWith(1, expect.any(Function));

    // Now dispatch a synthetic input event (like React or Quill might trigger during programmatic update)
    const syntheticInput = new InputEvent('input', { bubbles: true, cancelable: true });
    textarea.dispatchEvent(syntheticInput);

    // Should NOT trigger showAutoSanitizedPill with 0!
    expect(showSpy).toHaveBeenCalledTimes(1);
  });

  // --- Category 4: False-Positive Immunity Tests (Must NOT Sanitize) ---

  it('11. False-Positive Immunity: Unix timestamps are NOT sanitized as phone numbers or credit cards', () => {
    const vault = new EntityVault();
    const timestamps = `
const buildTime = 1710000000;
const epoch = 1709856000;
    `.trim();

    const result = sanitizePrompt(timestamps, vault);
    expect(result.hasChanges).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.sanitizedText).toBe(timestamps);
  });

  it('12. False-Positive Immunity: Semantic versions (v1.2.3.4, 1.2.3) are NOT matched as IP addresses', () => {
    const vault = new EntityVault();
    const code = `
We just upgraded to v1.2.3.4 and released package version 2.4.6.8.
Please check the v1.2.3.4 release notes.
    `.trim();

    const result = sanitizePrompt(code, vault);
    expect(result.hasChanges).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.sanitizedText).toBe(code);
  });

  it('13. False-Positive Immunity: Localhost, private, and documentation IPs are NOT sanitized', () => {
    const vault = new EntityVault();
    const networkConfig = `
Connect to local server at 127.0.0.1:8080 or http://192.168.1.1/admin.
Internal gateway is 10.0.0.1 with subnet mask 255.255.255.0.
Default route: 0.0.0.0/0.
    `.trim();

    const result = sanitizePrompt(networkConfig, vault);
    expect(result.hasChanges).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.sanitizedText).toBe(networkConfig);
  });

  it('14. False-Positive Immunity: 16-digit non-Luhn order IDs are NOT sanitized as credit cards', () => {
    const vault = new EntityVault();
    const orderText = 'Order confirmation #1234567812345678 has been shipped to warehouse.';

    const result = sanitizePrompt(orderText, vault);
    expect(result.hasChanges).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.sanitizedText).toBe(orderText);
  });

  it('15. False-Positive Immunity: Normal English prose containing "password" without assignment is NOT sanitized', () => {
    const vault = new EntityVault();
    const questions = `
How do I hash a password in Go using bcrypt?
Can you explain the difference between a password and a passphrase?
The user forgot their password and needs to reset it.
    `.trim();

    const result = sanitizePrompt(questions, vault);
    expect(result.hasChanges).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.sanitizedText).toBe(questions);
  });

  it('16. False-Positive Immunity: TypeScript type annotations (password: string) are NOT sanitized as passwords', () => {
    const vault = new EntityVault();
    const tsCode = `
interface UserCredentials {
  username: string;
  password: string;
  client_secret: string;
}
    `.trim();

    const result = sanitizePrompt(tsCode, vault);
    expect(result.hasChanges).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.sanitizedText).toBe(tsCode);
  });

  it('17. PEM Private Key Blocks: properly sanitizes full RSA private key block', () => {
    const vault = new EntityVault();
    const pem = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAz7zZ234567890abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----
    `.trim();

    const result = sanitizePrompt(pem, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(1);
    expect(result.sanitizedText).toBe('[SECRET_1]');
  });

  it('18. Regression: sanitizes lowercase aws_access_key_id and aws_secret_access_key (min length 16)', () => {
    const vault = new EntityVault();
    const prompt = `
aws_access_key_id=custom_access_key_12345
aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
    `.trim();

    const result = sanitizePrompt(prompt, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(2);
    expect(result.sanitizedText).toContain('aws_access_key_id=[SECRET_1]');
    expect(result.sanitizedText).toContain('aws_secret_access_key=[SECRET_2]');
    expect(result.sanitizedText).not.toContain('custom_access_key_12345');
    expect(result.sanitizedText).not.toContain('wJalrXUtnFEMI');
  });

  it('19. Regression: sanitizes Authorization: Bearer <token> headers', () => {
    const vault = new EntityVault();
    const prompt = 'curl -H "Authorization: Bearer my_super_secret_bearer_token_12345" https://api.example.com';

    const result = sanitizePrompt(prompt, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(1);
    expect(result.sanitizedText).toBe('curl -H "Authorization: Bearer [SECRET_1]" https://api.example.com');
    expect(result.sanitizedText).not.toContain('my_super_secret_bearer_token_12345');
    expect(vault.getOriginal('[SECRET_1]')).toBe('my_super_secret_bearer_token_12345');
  });

  it('20. Regression: sanitizes ENCRYPTED PRIVATE KEY and PGP PRIVATE KEY BLOCK', () => {
    const vault = new EntityVault();
    const keys = `
-----BEGIN ENCRYPTED PRIVATE KEY-----
MIIFDjBABgkqhkiG9w0BBQ0wMzAbBgkqhkiG9w0BBQwwDgQI1234567890abcdef
-----END ENCRYPTED PRIVATE KEY-----

-----BEGIN PGP PRIVATE KEY BLOCK-----
Version: BCPG C# v1.6.1.0
lQOsBF234567890abcdefghijklmnopqrstuvwxyz
-----END PGP PRIVATE KEY BLOCK-----
    `.trim();

    const result = sanitizePrompt(keys, vault);
    expect(result.hasChanges).toBe(true);
    expect(result.matchCount).toBe(2);
    expect(result.sanitizedText).toBe('[SECRET_1]\n\n[SECRET_2]');
    expect(result.sanitizedText).not.toContain('ENCRYPTED PRIVATE KEY');
    expect(result.sanitizedText).not.toContain('PGP PRIVATE KEY BLOCK');
  });
});
