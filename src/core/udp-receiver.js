// -*- coding: utf-8 -*-

/**
 * UDP Receiver。
 *
 * 负责监听 Python LogParser 发来的 UDP JSON 事件。
 *
 * 重要边界：
 * 1. UDP 只是实时通知通道，不是可靠队列。
 * 2. Python 端 LogPost 才是可靠落盘。
 * 3. JS 端收到 UDP 后，立刻转入 EventBus。
 */

import dgram from "node:dgram";

export class UdpReceiver {
  /**
   * @param {object} options
   * @param {string} options.host 监听地址
   * @param {number} options.port 监听端口
   * @param {number} options.maxMessageBytes 最大消息大小
   * @param {object} options.logger 日志器
   */
  constructor({ host, port, maxMessageBytes, logger }) {
    this.host = host;
    this.port = Number(port);
    this.maxMessageBytes = Number(maxMessageBytes);
    this.logger = logger;

    this.socket = dgram.createSocket("udp4");

    /**
     * UDP 收到合法事件后的回调。
     *
     * @type {null | ((event: object, remoteInfo: object) => void)}
     */
    this.eventCallback = null;

    this.socket.on("message", (buffer, remoteInfo) => {
      this.handleMessage(buffer, remoteInfo);
    });

    this.socket.on("error", (error) => {
      this.logger.error(`UDP socket error: ${error.stack ?? error}`);
    });
  }

  /**
   * 注册事件回调。
   *
   * @param {(event: object, remoteInfo: object) => void} callback
   */
  onEvent(callback) {
    this.eventCallback = callback;
  }

  /**
   * 启动 UDP 监听。
   */
  start() {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        this.socket.off("listening", onListening);
        reject(error);
      };

      const onListening = () => {
        this.socket.off("error", onError);
        resolve();
      };

      this.socket.once("error", onError);
      this.socket.once("listening", onListening);
      this.socket.bind(this.port, this.host);
    });
  }

  /**
   * 停止 UDP 监听。
   */
  stop() {
    return new Promise((resolve) => {
      try {
        this.socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  /**
   * 处理单个 UDP 消息。
   *
   * @param {Buffer} buffer UDP 原始数据
   * @param {object} remoteInfo UDP 来源信息
   */
  handleMessage(buffer, remoteInfo) {
    if (buffer.length > this.maxMessageBytes) {
      this.logger.warn(`UDP message too large. Bytes=${buffer.length}`);
      return;
    }

    const text = buffer.toString("utf8");
    let event;

    try {
      event = JSON.parse(text);
    } catch {
      this.logger.warn(`Invalid UDP JSON from ${remoteInfo.address}:${remoteInfo.port}`);
      return;
    }

    if (!event || typeof event !== "object") {
      this.logger.warn("UDP JSON is not an object.");
      return;
    }

    if (!event.Event || typeof event.Event !== "string") {
      this.logger.warn("UDP event missing Event field.");
      return;
    }

    if (this.eventCallback) {
      this.eventCallback(event, remoteInfo);
    }
  }
}
