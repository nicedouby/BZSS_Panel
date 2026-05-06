// -*- coding: utf-8 -*-

import dgram from "node:dgram";
import { normalizeRawGameEvent } from "./event-normalizer.js";

/**
 * Core: UdpEventReceiver
 *
 * 接收 Python LogParser 发来的 UDP JSON 事件，并发布为 Core Event。
 */
export class UdpEventReceiver {
  constructor({ config, logger, eventBus, webStatus }) {
    this.host = config.host ?? "127.0.0.1";
    this.port = Number(config.port ?? 6666);
    this.maxMessageBytes = Number(config.maxMessageBytes ?? 65535);

    this.logger = logger;
    this.eventBus = eventBus;
    this.webStatus = webStatus;
    this.socket = dgram.createSocket("udp4");

    this.socket.on("message", (buffer, remoteInfo) => this.handleMessage(buffer, remoteInfo));
    this.socket.on("error", (error) => this.logger.error(`UDP socket error: ${error.stack ?? error}`));
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.socket.once("listening", resolve);
      this.socket.once("error", reject);
      this.socket.bind(this.port, this.host);
    });

    this.webStatus.set("udpReceiver", "listening");
    this.logger.info(`UDP Receiver listening on ${this.host}:${this.port}`);
  }

  async stop() {
    this.webStatus.set("udpReceiver", "stopped");

    await new Promise((resolve) => {
      try { this.socket.close(resolve); } catch { resolve(); }
    });
  }

  handleMessage(buffer, remoteInfo) {
    if (buffer.length > this.maxMessageBytes) {
      this.logger.warn(`UDP message too large. Bytes=${buffer.length}`);
      return;
    }

    let rawEvent;
    try {
      rawEvent = JSON.parse(buffer.toString("utf8"));
    } catch {
      this.logger.warn(`Invalid UDP JSON from ${remoteInfo.address}:${remoteInfo.port}`);
      return;
    }

    if (!rawEvent.Event) {
      this.logger.warn("UDP event missing Event field.");
      return;
    }

    const event = normalizeRawGameEvent(rawEvent);
    event.udpRemoteAddress = remoteInfo.address;
    event.udpRemotePort = remoteInfo.port;

    this.eventBus.emitCoreEvent(event.eventName, event);
  }
}
