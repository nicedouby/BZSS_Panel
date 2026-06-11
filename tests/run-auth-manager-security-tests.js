import assert from "node:assert/strict";

import { AuthManager } from "../core/auth-manager.js";

async function testProductionRejectsInsecureCookie() {
  const manager = new AuthManager({
    config: {
      enabled: true,
      environment: "production",
      secureCookie: false,
    },
    logger: {},
  });

  await assert.rejects(() => manager.start(), /secureCookie=true/);
}

async function testSessionCookieUsesHostPrefixAndSecureFlags() {
  const manager = new AuthManager({
    config: {
      enabled: true,
      environment: "production",
      secureCookie: true,
      sessionCookieName: "__Host-bzss_session",
    },
    logger: {},
  });

  await manager.start();
  const result = await manager.login({
    username: "DoubyBear",
    password: "wrong-password",
    ip: "127.0.0.1",
  });
  assert.equal(result.ok, false);

  const cookieHeaders = manager.makeSessionCookie("token", Date.now() + 60_000);
  assert.equal(Array.isArray(cookieHeaders), true);
  assert.match(cookieHeaders[0], /^__Host-bzss_session=token;/);
  assert.match(cookieHeaders[0], /Path=\//);
  assert.match(cookieHeaders[0], /Secure/);
  assert.match(cookieHeaders[0], /HttpOnly/);
  assert.match(cookieHeaders[0], /SameSite=Strict/);
  assert.doesNotMatch(cookieHeaders[0], /Domain=/);
  assert.match(cookieHeaders[1], /^bzss_session=/);
  assert.match(cookieHeaders[1], /Max-Age=0/);

  const expiredCookie = manager.makeExpiredCookie();
  assert.match(expiredCookie, /^__Host-bzss_session=/);
  assert.match(expiredCookie, /Path=\//);
  assert.match(expiredCookie, /Secure/);
  assert.match(expiredCookie, /HttpOnly/);
  assert.match(expiredCookie, /SameSite=Strict/);
}

await testProductionRejectsInsecureCookie();
await testSessionCookieUsesHostPrefixAndSecureFlags();

console.log("auth manager security tests passed");
