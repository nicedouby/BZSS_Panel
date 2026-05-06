#!/usr/bin/env node
// -*- coding: utf-8 -*-

/**
 * UDP 测试事件发送器。
 *
 * 用法：
 * 1. 先启动 JS Receiver：
 *    node src/main.js
 *
 * 2. 再开另一个终端运行：
 *    node src/tools/send-test-event.js
 *
 * 它会向 127.0.0.1:7788 发送一个模拟 On_PlayerDied 事件。
 */

import dgram from "node:dgram";

const socket = dgram.createSocket("udp4");

const event = {
  Version: "1",
  ServerID: "TestServer",
  SessionID: "TestSession",
  Seq: "1",
  Event: "On_PlayerDied",
  Time: new Date().toISOString(),
  LogTime: "2026.05.06-05.30.49:174",
  Param1_VictimName: "Braovo",
  Param2_KillingDamage: "-300.000000",
  Param3_AttackerName: "",
  Param4_AttackerEOSID: "",
  Param5_AttackerSteam64ID: "",
  Param6_AttackerControllerID: "",
  Param7_FromObject: "",
  Param8_CausedBy: "BP_Soldier_PLA_SquadLeader_Arid_C_2147373303",
  Param9_Confidence: "Low",
  Raw: "[TEST] Fake Squad log line"
};

const payload = Buffer.from(JSON.stringify(event), "utf8");

socket.send(payload, 7788, "127.0.0.1", (error) => {
  if (error) {
    console.error("发送失败:", error);
    process.exit(1);
  }

  console.log("测试事件已发送。");
  socket.close();
});
