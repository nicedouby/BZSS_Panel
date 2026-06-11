import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HttpsCertificateManager } from "../core/https-certificate-manager.js";

async function testLoadsExistingCertificateFiles() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-https-cert-"));
  const keyPath = path.join(tempDir, "panel.key");
  const certPath = path.join(tempDir, "panel.crt");
  await fs.writeFile(keyPath, "KEYDATA", "utf8");
  await fs.writeFile(certPath, "CERTDATA", "utf8");

  const manager = new HttpsCertificateManager({
    config: {
      keyPath,
      certPath,
      certDir: tempDir,
      autoGenerateSelfSigned: true,
    },
    logger: {},
    commandRunner: async () => {
      throw new Error("commandRunner should not be called when files already exist");
    },
  });

  const tlsOptions = await manager.loadTlsOptions();
  assert.equal(tlsOptions.key.toString("utf8"), "KEYDATA");
  assert.equal(tlsOptions.cert.toString("utf8"), "CERTDATA");
}

async function testGeneratesCertificateWhenMissing() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-https-cert-gen-"));
  const keyPath = path.join(tempDir, "panel.key");
  const certPath = path.join(tempDir, "panel.crt");
  const calls = [];

  const manager = new HttpsCertificateManager({
    config: {
      keyPath,
      certPath,
      certDir: tempDir,
      autoGenerateSelfSigned: true,
      commonName: "BZSS Panel",
      validDays: 825,
    },
    logger: {},
    commandRunner: async (config) => {
      calls.push(config);
      await fs.writeFile(keyPath, "GENERATED_KEY", "utf8");
      await fs.writeFile(certPath, "GENERATED_CERT", "utf8");
    },
  });

  const tlsOptions = await manager.loadTlsOptions();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].commonName, "BZSS Panel");
  assert.equal(calls[0].validDays, 825);
  assert.equal(tlsOptions.key.toString("utf8"), "GENERATED_KEY");
  assert.equal(tlsOptions.cert.toString("utf8"), "GENERATED_CERT");
}

await testLoadsExistingCertificateFiles();
await testGeneratesCertificateWhenMissing();

console.log("https certificate manager tests passed");
