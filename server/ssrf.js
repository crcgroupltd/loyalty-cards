// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

// Fetching URLs on behalf of users without letting them reach the internal
// network. The address is checked inside the socket's DNS lookup, so the
// address that was checked is the one connected to (no DNS-rebinding gap),
// and every redirect hop goes through the same check.
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
]) blocked.addSubnet(addr, prefix, 'ipv6');

export function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    if (/^::ffff:/i.test(ip)) return true;
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

// A dns.lookup replacement that refuses blocked addresses.
export function guardedLookup(baseLookup = dns.lookup) {
  return (hostname, options, callback) => {
    baseLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family }];
      const bad = list.find((a) => isBlockedAddress(a.address));
      if (bad || list.length === 0) {
        const e = new Error(`Blocked address for ${hostname}`);
        e.code = 'EBLOCKED';
        return callback(e);
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

export function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { code: 'EBADURL' });
  }
  if (url.protocol !== 'https:') throw Object.assign(new Error('Only https URLs are allowed'), { code: 'EBADURL' });
  if (url.username || url.password) throw Object.assign(new Error('Credentials in URL'), { code: 'EBADURL' });
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw Object.assign(new Error('IP address URLs are not allowed'), { code: 'EBADURL' });
  }
  return url;
}

// GETs an https URL with size, time and redirect limits.
// Resolves to { status, headers, body: Buffer }.
export async function safeFetch(raw, { maxBytes = 2 * 1024 * 1024, timeoutMs = 5000, maxRedirects = 3, headers = {}, lookup } = {}) {
  let url = checkUrl(raw);
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, { maxBytes, deadline, headers, lookup: guardedLookup(lookup) });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop >= maxRedirects) throw Object.assign(new Error('Too many redirects'), { code: 'EREDIRECT' });
      url = checkUrl(new URL(res.headers.location, url).href);
      continue;
    }
    return res;
  }
}

function requestOnce(url, { maxBytes, deadline, headers, lookup }) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' }));
    const req = https.get(url, { headers: { 'user-agent': 'bmc-loyalty-card', ...headers }, lookup, timeout: remaining }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(Object.assign(new Error('Response too large'), { code: 'ETOOBIG' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}
