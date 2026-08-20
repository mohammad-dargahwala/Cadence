'use strict';

const crypto = require('crypto');

/* Login is name + passphrase — no email, no external identity provider.
 * Passphrases are hashed with scrypt (built into Node, no extra dependency)
 * before they ever touch the database; the plaintext is never stored or
 * logged. This is deliberately lightweight, matching the rest of the app's
 * "no accounts, no secrets infrastructure" posture — a real deployment
 * fronted by anything beyond personal/small-group use should sit behind a
 * proper auth provider instead. */

const MIN_PASSPHRASE = 4;
const MAX_PASSPHRASE = 200;
const MAX_NAME = 40;

function validateName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name || name.length > MAX_NAME) return null;
  return name;
}

function validatePassphrase(raw) {
  const pass = String(raw == null ? '' : raw);
  if (pass.length < MIN_PASSPHRASE || pass.length > MAX_PASSPHRASE) return null;
  return pass;
}

/** 'saltHex:hashHex', scrypt with a random 16-byte salt per user. */
function hashPassphrase(pass) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pass, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassphrase(pass, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[0], 'hex');
    expected = Buffer.from(parts[1], 'hex');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(pass, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { validateName, validatePassphrase, hashPassphrase, verifyPassphrase };
