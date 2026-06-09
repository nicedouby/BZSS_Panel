import os

file_path = r'core\web-server.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

marker = 'await new Promise((resolve) => {'
index = content.find(marker)

if index == -1:
    print("Could not find the marker in web-server.js!")
    exit(1)

rest_of_file = content[index:]

top_part = """// -*- coding: utf-8 -*-

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { handleSquadManagementRoutes } from "../modules/squad-management/routes.js";
import { handleTeamBalanceRoutes } from "../modules/team-balance/routes.js";
import { handleReserveSlotsRoutes } from "../modules/reserve-slots/routes.js";
import {
  classifySquadName,
  getSquadNameClassifierRules,
  getSquadNameExactRuleConfig,
  updateSquadNameExactRuleConfig,
} from "./squad-name-classifier.js";
import {
  getAllPlugins,
  setPluginEnabled as updatePluginEnabled,
  updatePluginConfig as updatePluginManifestConfig,
} from "./plugins/plugin.service.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;

export class WebServer {
  constructor({ config, logger, core, modules }) {
    this.enabled = config.enabled ?? true;
    this.host = config.host ?? "127.0.0.1";
    this.port = Number(config.port ?? 8899);
    this.useVueClient = Boolean(config.useVueClient);
    this.staticDirectory = path.resolve(
      process.cwd(),
      this.useVueClient ? "./web-client/dist" : (config.staticDirectory ?? "./web"),
    );

    this.logger = logger;
    this.core = core;
    this.modules = modules;
    this.server = null;
    this.jobs = new Map();
    this.jobCounter = 0;
    this.consoleConnections = new Set();
    this.chatConnections = new Set();
    this.consoleSubscription = null;
    this.chatSubscription = null;

    this.memoryHistory = [];
    this.maxMemoryHistoryPoints = 120;
    this.memoryInterval = null;
  }

  async start() {
    if (!this.enabled) {
      this.logger.info("WebServer disabled.");
      return;
    }

    await this.warnIfStaticIndexMissing();

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        const statusCode = error.statusCode ?? 500;
        if (statusCode >= 500) {
          this.logger.error(`Web request failed: ${error.stack ?? error}`);
        } else {
          this.logger.warn(`Web request rejected: ${statusCode} ${error.code ?? error.message}`);
        }
        this.json(res, statusCode, {
          error: error.code ?? "InternalServerError",
          message: error.message,
        });
      });
    });

    this.server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket, head).catch((error) => {
        this.logger.warn(`WebSocket upgrade rejected: ${error?.message ?? error}`);
        try {
          socket.destroy();
        } catch {}
      });
    });

    if (this.core.console?.subscribe) {
      this.consoleSubscription = this.core.console.subscribe((entry) => {
        this.broadcastConsoleEntry(entry);
      });
    }

    if (typeof this.modules.chatManager?.on === "function") {
      this.chatSubscription = this.modules.chatManager.on("message", (entry) => {
        this.broadcastChatEntry(entry);
      });
    }

    """

new_content = top_part + rest_of_file
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Successfully rebuilt web-server.js using Python inside workspace!")
