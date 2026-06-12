#!/usr/bin/env node
// -*- coding: utf-8 -*-

import readline from "node:readline/promises";
import { Writable } from "node:stream";

import { hashPassword } from "../core/auth-crypto.js";
import { AuthUserStore, normalizeRole } from "../core/auth-user-store.js";

const command = String(process.argv[2] ?? "").trim().toLowerCase();
const firstArg = String(process.argv[3] ?? "").trim();

const store = new AuthUserStore({
  config: {
    usersFilePath: "./data/auth/users.json",
  },
  logger: console,
});

await store.start();

switch (command) {
  case "add":
    await handleAdd();
    break;
  case "list":
    handleList();
    break;
  case "disable":
    await handleSetEnabled(false);
    break;
  case "enable":
    await handleSetEnabled(true);
    break;
  case "reset-password":
    await handleResetPassword();
    break;
  case "delete":
    await handleDelete();
    break;
  default:
    printUsage();
    process.exitCode = 1;
}

async function handleAdd() {
  const rl = createPrompt();
  try {
    const username = await promptRequired(rl, "Username: ");
    const roleInput = await promptWithDefault(rl, "Role (Admin / SuperAdmin): ", "Admin");
    const role = normalizeRole(roleInput);
    const password = await promptPassword(rl, "Password: ");
    const confirm = await promptPassword(rl, "Confirm password: ");

    if (password !== confirm) {
      throw new Error("Passwords do not match.");
    }

    const passwordHash = await hashPassword(password);
    const user = await store.createUser({ username, role, passwordHash });
    console.log(`Created user: ${user.username} (${user.role})`);
  } finally {
    rl.close();
  }
}

function handleList() {
  const users = store.listUsers();
  if (!users.length) {
    console.log("No users.");
    return;
  }

  for (const user of users) {
    console.log(`${user.username}\t${user.role}\t${user.enabled ? "enabled" : "disabled"}`);
  }
}

async function handleSetEnabled(enabled) {
  const rl = createPrompt();
  try {
    const username = firstArg || await promptRequired(rl, "Username: ");
    const user = await store.setUserEnabled(username, enabled);
    console.log(`${enabled ? "Enabled" : "Disabled"} user: ${user.username} (${user.role})`);
  } finally {
    rl.close();
  }
}

async function handleResetPassword() {
  const rl = createPrompt();
  try {
    const username = firstArg || await promptRequired(rl, "Username: ");
    const password = await promptPassword(rl, "New password: ");
    const confirm = await promptPassword(rl, "Confirm password: ");
    if (password !== confirm) {
      throw new Error("Passwords do not match.");
    }

    const passwordHash = await hashPassword(password);
    const user = await store.updatePassword(username, passwordHash);
    console.log(`Reset password: ${user.username} (${user.role})`);
  } finally {
    rl.close();
  }
}

async function handleDelete() {
  const rl = createPrompt();
  try {
    const username = firstArg || await promptRequired(rl, "Username: ");
    const confirmed = await promptWithDefault(rl, `Delete ${username}? (yes/no): `, "no");
    if (confirmed.trim().toLowerCase() !== "yes") {
      console.log("Cancelled.");
      return;
    }

    const user = await store.deleteUser(username);
    console.log(`Deleted user: ${user.username} (${user.role})`);
  } finally {
    rl.close();
  }
}

function createPrompt() {
  const mutableStdout = new Writable({
    write(chunk, encoding, callback) {
      if (!mutableStdout.muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    },
  });
  mutableStdout.muted = false;

  return readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true,
  });
}

async function promptRequired(rl, message) {
  while (true) {
    const value = String(await rl.question(message)).trim();
    if (value) return value;
  }
}

async function promptWithDefault(rl, message, defaultValue) {
  const value = String(await rl.question(message)).trim();
  return value || defaultValue;
}

async function promptPassword(rl, message) {
  rl.output.muted = false;
  process.stdout.write(message);
  rl.output.muted = true;
  const value = String(await rl.question("")).trim();
  rl.output.muted = false;
  process.stdout.write("\n");
  if (!value) {
    throw new Error("Password is required.");
  }
  return value;
}

function printUsage() {
  console.log("Usage: node scripts/auth-users.js <add|list|disable|enable|reset-password|delete> [username]");
}
