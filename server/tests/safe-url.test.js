const { parseHttpsUrl, assertSafeAttachmentUrl, isBlockedIp } = require('../src/lib/safeUrl');

describe('safeUrl', () => {
  it('rejects http and private IP webhook targets', () => {
    expect(() => parseHttpsUrl('http://127.0.0.1/')).toThrow(/https/);
    expect(() => parseHttpsUrl('https://127.0.0.1/')).toThrow(/not allowed/);
    expect(() => parseHttpsUrl('https://169.254.169.254/')).toThrow(/not allowed/);
    expect(() => parseHttpsUrl('https://10.0.0.4/hooks')).toThrow(/not allowed/);
    expect(() => parseHttpsUrl('https://localhost/hooks')).toThrow(/not allowed/);
    expect(() => parseHttpsUrl('https://example.com/hooks')).not.toThrow();
  });

  it('only allowlists Resend hosts for attachment downloads', () => {
    expect(() => assertSafeAttachmentUrl('http://127.0.0.1:4000/api/health')).toThrow();
    expect(() => assertSafeAttachmentUrl('https://evil.example/file')).toThrow();
    expect(() => assertSafeAttachmentUrl('https://resend.com.evil.test/file')).toThrow();
    expect(() => assertSafeAttachmentUrl('https://attachments.resend.com/file.pdf')).not.toThrow();
  });

  it('treats RFC1918, loopback, and link-local addresses as blocked', () => {
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('10.1.2.3')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });
});
