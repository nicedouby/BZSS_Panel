// -*- coding: utf-8 -*-

import dgram from "node:dgram";

/**
 * Core: UdpEventReceiver
 *
 * 接收 Python LogParser 发来的 UDP JSON 事件，并发布为 Core Event。
 */
export class UdpEventReceiver {
  constructor({ config, logger, eventBus, webStatus, eventPipeline }) {
    this.host = config.host ?? "127.0.0.1";
    this.port = Number(config.port ?? 6666);
    this.maxMessageBytes = Number(config.maxMessageBytes ?? 65535);

    this.logger = logger;
    this.eventBus = eventBus;
    this.webStatus = webStatus;
    this.eventPipeline = eventPipeline;
    this.socket = dgram.createSocket("udp4");
    this.isStarting = false;

    this.socket.on("message", (buffer, remoteInfo) => this.handleMessage(buffer, remoteInfo));
    this.socket.on("error", (error) => {
      if (this.isStarting) return;

      this.webStatus.set("udpReceiver", "error");
      this.logger.error(`UDP socket error: ${error.stack ?? error}`, {
        operation: "socketError",
      });
    });
  }

  async start() {
    this.isStarting = true;

    await new Promise((resolve, reject) => {
      const onListening = () => {
        this.socket.off("error", onError);
        this.isStarting = false;
        resolve();
      };

      const onError = (error) => {
        this.socket.off("listening", onListening);
        this.isStarting = false;
        this.webStatus.set("udpReceiver", "error");
        reject(wrapUdpStartupError(error, this.host, this.port));
      };

      this.socket.once("listening", onListening);
      this.socket.once("error", onError);
      this.socket.bind(this.port, this.host);
    });

    this.webStatus.set("udpReceiver", "listening");
    this.logger.info(`UDP Receiver listening on ${this.host}:${this.port}`, {
      operation: "start",
    });
  }

  async stop() {
    this.webStatus.set("udpReceiver", "stopped");

    await new Promise((resolve) => {
      try { this.socket.close(resolve); } catch { resolve(); }
    });
  }

  handleMessage(buffer, remoteInfo) {
    if (buffer.length > this.maxMessageBytes) {
      this.logger.warn(`UDP message too large. Bytes=${buffer.length}`, {
        operation: "handleMessage",
        data: {
          bytes: buffer.length,
          remote: `${remoteInfo.address}:${remoteInfo.port}`,
        },
      });
      return;
    }

    let rawEvent;
    try {
      rawEvent = JSON.parse(buffer.toString("utf8"));
    } catch {
      /*this.logger.warn(`Invalid UDP JSON from ${remoteInfo.address}:${remoteInfo.port}`, {
        operation: "handleMessage",
        data: {
          bytes: buffer.length,
        },
      });*/
      return;
    }
    
    if (!rawEvent.Event) {
      this.logger.warn("UDP event missing Event field.", {
        operation: "handleMessage",
        data: {
          remote: `${remoteInfo.address}:${remoteInfo.port}`,
        },
      });
      return;
    }

    const event = this.eventPipeline.processRawGameEvent(rawEvent);
    event.udpRemoteAddress = remoteInfo.address;
    event.udpRemotePort = remoteInfo.port;

    this.logger.debug(() => `UDP event accepted ${event.eventName}`, {
      operation: "handleMessage",
      eventName: event.eventName,
      data: {
        remote: `${remoteInfo.address}:${remoteInfo.port}`,
      },
    });

    this.eventBus.emitCoreEvent(event.eventName, event);
  }
}

function wrapUdpStartupError(error, host, port) {
  if (!error || typeof error !== "object") {
    return new Error(`Failed to start UDP receiver on ${host}:${port}`);
  }

  if (error.code === "EADDRINUSE") {
    const wrapped = new Error(
      `UDP ${host}:${port} is already in use. Another BZSS Panel instance or log parser is likely already running. Stop the existing process or change udp.port in config.json before starting again.`,
    );
    wrapped.code = error.code;
    wrapped.cause = error;
    return wrapped;
  }

  return error;
}
