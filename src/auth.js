'use strict';

/* Login is name + PIN — no email, no external identity provider, no strong
 * security posture attempted: a PIN is a handful of digits by design. The
 * salted SHA-256 hash below (Web Crypto, built into the Workers runtime) is
 * light hygiene so a PIN never sits in the database in the clear — not a
 * claim that this resists a serious attacker. For anything beyond personal
 * or small-group use, put a real auth provider in front of the API. */

const MIN_PIN = 4;
const MAX_PIN = 8;
const MAX_NAME = 40;

function validateName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name || name.length > MAX_NAME) return null;
  return name;
}

function validatePin(raw) {
  const pin = String(raw == null ? '' : raw).trim();
  if (pin.length < MIN_PIN || pin.length > MAX_PIN || !/^\d+$/.test(pin)) return null;
  return pin;
}

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function digestHex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bufToHex(digest);
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** 'saltHex:hashHex', SHA-256 with a random 16-byte salt per user. */
async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await digestHex(concat(salt, new TextEncoder().encode(pin)));
  return bufToHex(salt) + ':' + hash;
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPin(pin, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  let salt;
  try {
    salt = hexToBuf(parts[0]);
  } catch {
    return false;
  }
  if (!salt.length) return false;
  const hash = await digestHex(concat(salt, new TextEncoder().encode(pin)));
  return timingSafeEqualHex(hash, parts[1]);
}

module.exports = { validateName, validatePin, hashPin, verifyPin };
