// -*- coding: utf-8 -*-

import crypto from "node:crypto";

export const INVALID_PASSWORD_HASH = "scrypt$bzss-invalid-v1$UpgdHuTdcHnUYRfcBTFvC0by9qv9iboyj_VwZCfhJH5Xg1ZceJ637AMeDSSBZKSphN2Z_uIfGyl_AaOkBENdZw";

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt);
  return `scrypt$${salt}$${hash}`;
}

export async function verifyPassword(password, encoded) {
  const [kind, salt, expected] = String(encoded ?? "").split("$");
  if (kind !== "scrypt" || !salt || !expected) return false;

  const actual = await scrypt(password, salt);
  return timingSafeEqual(actual, expected);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("base64url");
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), String(salt), 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString("base64url"));
    });
  });
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
