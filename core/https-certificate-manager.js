import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import selfsigned from "selfsigned";

const execFileAsync = promisify(execFile);

export class HttpsCertificateManager {
  constructor({ config = {}, logger, commandRunner } = {}) {
    this.config = config;
    this.logger = logger;
    this.commandRunner = commandRunner ?? defaultCommandRunner;
  }

  async loadTlsOptions() {
    const keyPath = this.resolvePath(this.config.keyPath ?? "./data/certs/bzss-panel.key");
    const certPath = this.resolvePath(this.config.certPath ?? "./data/certs/bzss-panel.crt");
    const certDir = this.resolvePath(this.config.certDir ?? path.dirname(keyPath));

    const hasKey = await exists(keyPath);
    const hasCert = await exists(certPath);

    if (!hasKey || !hasCert) {
      if (this.config.autoGenerateSelfSigned !== true) {
        throw new Error(`HTTPS certificate files are missing: ${keyPath}, ${certPath}`);
      }
      await this.generateSelfSignedCertificate({ certDir, keyPath, certPath });
    }

    return {
      key: await fs.readFile(keyPath),
      cert: await fs.readFile(certPath),
    };
  }

  async generateSelfSignedCertificate({ certDir, keyPath, certPath }) {
    await fs.mkdir(certDir, { recursive: true });
    const commonName = String(this.config.commonName ?? "BZSS Panel").trim() || "BZSS Panel";

    this.logger?.info?.(`Generating self-signed HTTPS certificate in ${certDir}`);
    try {
      await this.commandRunner({
        commonName,
        keyPath,
        certPath,
        validDays: Number(this.config.validDays ?? 825),
      });
    } catch (error) {
      throw new Error(
        `Failed to generate HTTPS certificate. ${error.message}`,
      );
    }
  }

  resolvePath(targetPath) {
    return path.resolve(process.cwd(), String(targetPath ?? "").trim());
  }
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function defaultCommandRunner({ commonName, keyPath, certPath, validDays }) {
  const attrs = [{ name: "commonName", value: commonName }];
  const options = {
    days: validDays,
    algorithm: "sha256",
    keySize: 2048,
  };

  const pem = await selfsigned.generate(attrs, options);
  await fs.writeFile(keyPath, pem.private, "utf8");
  await fs.writeFile(certPath, pem.cert, "utf8");
}
