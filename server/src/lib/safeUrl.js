const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
]);

function ipv4ToInt(ip) {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ipInt, base, bits) {
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return (ipInt & mask) === (base & mask);
}

function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return (
    inCidr(n, ipv4ToInt('0.0.0.0'), 8) ||
    inCidr(n, ipv4ToInt('10.0.0.0'), 8) ||
    inCidr(n, ipv4ToInt('127.0.0.0'), 8) ||
    inCidr(n, ipv4ToInt('169.254.0.0'), 16) ||
    inCidr(n, ipv4ToInt('172.16.0.0'), 12) ||
    inCidr(n, ipv4ToInt('192.168.0.0'), 16)
  );
}

function isBlockedIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) return isBlockedIPv4(mapped);
  }
  return false;
}

function isBlockedIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return false;
}

function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (isBlockedIp(host)) return true;
  return false;
}

function parseHttpsUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('URL must use https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL must not include credentials');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('URL host is not allowed');
  }
  return parsed;
}

function isAllowedResendHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'resend.com' || host.endsWith('.resend.com');
}

function assertSafeAttachmentUrl(urlString) {
  const parsed = parseHttpsUrl(urlString);
  if (net.isIP(parsed.hostname) || !isAllowedResendHost(parsed.hostname)) {
    throw new Error('Attachment URL host is not allowlisted');
  }
  return parsed;
}

async function assertPublicHttpsUrl(urlString) {
  const parsed = parseHttpsUrl(urlString);
  let addresses;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error('URL host could not be resolved');
  }
  if (!addresses.length || addresses.some((a) => isBlockedIp(a.address))) {
    throw new Error('URL host resolves to a private or reserved address');
  }
  return parsed;
}

module.exports = {
  isBlockedIp,
  isBlockedHostname,
  parseHttpsUrl,
  assertSafeAttachmentUrl,
  assertPublicHttpsUrl,
};
