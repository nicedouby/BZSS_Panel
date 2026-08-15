// -*- coding: utf-8 -*-

import { createLogpostDiagnosticsModule as createBaseModule } from "./index.js";

/**
 * Enhances the cross-process sampler with the direct one-second timing windows
 * emitted by LogPost/bzss_parser/runtime_probe.py.
 */
export function createLogpostDiagnosticsModule(args) {
  const instance = createBaseModule(args);
  const core = args.core;
  const baseGetState = instance.api.getState.bind(instance.api);
  const baseStart = instance.start?.bind(instance);
  let lastParserOffset = null;
  let lastBridgeOffset = null;
  let parserProgressAt = Date.now();
  let bridgeProgressAt = Date.now();

  instance.api.getState = () => enhanceState(baseGetState());
  instance.start = async () => {
    if (baseStart) await baseStart();
    core.webRegistry.registerPage({
      id: "web.logpostPacketLoss",
      title: "LogPost 丢包监控",
      group: "系统",
      route: "/system/logpost-packet-loss",
      source: "module.logpostDiagnostics",
      description: "按 PacketSeq 对比 LogPost UDP 发送与接收，显示当前、1 分钟、5 分钟丢包率和连续丢包。",
      required: false,
      enabled: true,
      order: 1003,
      icon: "NET",
      superAdminOnly: true,
    });
  };

  function enhanceState(input) {
    if (!input || typeof input !== "object") return input;
    const state = { ...input };
    if (!state.latest?.pipeline) return state;

    const latest = {
      ...state.latest,
      pipeline: {
        ...state.latest.pipeline,
        parser: { ...(state.latest.pipeline.parser ?? {}) },
        fileBridge: { ...(state.latest.pipeline.fileBridge ?? {}) },
      },
      bottlenecks: Array.isArray(state.latest.bottlenecks) ? [...state.latest.bottlenecks] : [],
    };
    state.latest = latest;

    const now = Date.now();
    const parser = latest.pipeline.parser;
    const bridge = latest.pipeline.fileBridge;
    const parserOffset = finiteOrNull(parser.committedOffset);
    const bridgeOffset = finiteOrNull(bridge.currentOffset);

    if (parserOffset != null && parserOffset !== lastParserOffset) {
      lastParserOffset = parserOffset;
      parserProgressAt = now;
    }
    if (bridgeOffset != null && bridgeOffset !== lastBridgeOffset) {
      lastBridgeOffset = bridgeOffset;
      bridgeProgressAt = now;
    }
    parser.lastParserProgressAgeSeconds = Math.max(0, (now - parserProgressAt) / 1000);
    bridge.lastBridgeProgressAgeSeconds = Math.max(0, (now - bridgeProgressAt) / 1000);

    const probe = core.pythonLogParserManager?.getDiagnostics?.()
      ?? core.webStatus?.state?.logPostPythonDiagnostics
      ?? null;
    if (!probe || typeof probe !== "object") {
      const noStateYet = Number(parser.sourceSeq ?? 0) <= 0 && Number(parser.committedOffset ?? 0) <= 0;
      if (noStateYet && ["starting", "running"].includes(String(parser.status ?? "").toLowerCase())) {
        parser.stateAvailable = false;
        parser.backlogBytes = null;
        parser.backlogSeconds = null;
        latest.bottlenecks = latest.bottlenecks.filter((item) => !String(item?.stage ?? "").startsWith("python-"));
        normalizeOverall(latest);
      }
      return state;
    }

    parser.stateAvailable = true;
    parser.probe = probe;
    parser.backlogBytes = finiteOrNull(probe?.source?.backlogBytes) ?? parser.backlogBytes;
    parser.committedOffset = finiteOrNull(probe?.source?.position) ?? parser.committedOffset;
    parser.consumedBytesPerSec = finiteOrNull(probe?.rates?.sourceBytesReadPerSec) ?? parser.consumedBytesPerSec;
    parser.linesReadPerSec = finiteOrNull(probe?.rates?.linesReadPerSec);
    parser.linesProcessedPerSec = finiteOrNull(probe?.rates?.linesProcessedPerSec);
    parser.maxLineProcessMs = finiteOrNull(probe?.maxLineProcessMs);
    parser.processLineAvgMs = finiteOrNull(probe?.processLineAvgMs);
    parser.processLineP95Ms = finiteOrNull(probe?.processLineP95Ms);
    parser.processLineP99Ms = finiteOrNull(probe?.processLineP99Ms);
    parser.checkpointMaxMs = finiteOrNull(probe?.checkpointMaxMs);
    parser.checkpointP95Ms = finiteOrNull(probe?.checkpointP95Ms);
    parser.batchLines = finiteOrNull(probe?.batchLines);
    parser.batchBytes = finiteOrNull(probe?.batchBytes);
    parser.writerQueueDepth = finiteOrNull(probe?.writerQueueDepth);
    parser.writerQueueBytes = finiteOrNull(probe?.writerQueueBytes);
    parser.playerChunkParseMs = finiteOrNull(probe?.playerChunkParseMs);
    parser.stageShare = { ...(probe.stageShare ?? {}) };
    parser.stageDurationsMs = { ...(probe.durationsMs ?? {}) };
    parser.stageTimings = { ...(probe.stages ?? {}) };
    parser.slowestStage = String(probe.slowestStage ?? "unknown");

    const directDiagnosis = diagnosePythonProbe(probe, parser, {
      warningBacklogBytes: Number(state.thresholds?.sourceBacklogWarningBytes ?? 2 * 1024 * 1024),
      criticalBacklogBytes: Number(state.thresholds?.sourceBacklogCriticalBytes ?? 16 * 1024 * 1024),
      sourceRate: latest.rates?.sourceProducedBytesPerSec,
      consumeRate: parser.consumedBytesPerSec,
    });
    latest.bottlenecks = latest.bottlenecks.filter((item) => {
      const stage = String(item?.stage ?? "");
      return !["python-output-io", "python-parse-cpu", "python-pipeline"].includes(stage);
    });
    if (directDiagnosis) latest.bottlenecks.unshift(directDiagnosis);

    if (
      parser.lastParserProgressAgeSeconds >= Number(state.thresholds?.stalledSeconds ?? 8)
      && Number(parser.backlogBytes ?? 0) > 0
      && !latest.bottlenecks.some((item) => item?.stage === "python-stalled")
    ) {
      latest.bottlenecks.unshift({
        severity: "critical",
        stage: "python-stalled",
        title: "Python 读取游标停止推进",
        evidence: `stalled=${parser.lastParserProgressAgeSeconds.toFixed(1)}s, backlog=${formatBytes(parser.backlogBytes)}`,
        recommendation: "检查磁盘响应、控制台输出阻塞、单条超大日志，以及逐行 flush 是否卡住。",
      });
    }

    normalizeOverall(latest);
    return state;
  }

  return instance;
}

function diagnosePythonProbe(probe, parser, options = {}) {
  const shares = probe.stageShare ?? {};
  const fileIo = finite(shares.fileIo);
  const parse = finite(shares.parse);
  const read = finite(shares.read);
  const udp = finite(shares.udp);
  const other = finite(shares.other);
  const backlog = finite(parser.backlogBytes);
  const maxLineMs = finite(probe.maxLineProcessMs);
  const processP95Ms = finite(probe.processLineP95Ms);
  const processP99Ms = finite(probe.processLineP99Ms);
  const checkpointP95Ms = finite(probe.checkpointP95Ms);
  const slowest = String(probe.slowestStage ?? "unknown");
  const durations = probe.durationsMs ?? {};
  const warningBacklogBytes = finite(options.warningBacklogBytes) || 2 * 1024 * 1024;
  const criticalBacklogBytes = finite(options.criticalBacklogBytes) || 16 * 1024 * 1024;
  const sourceRate = finite(options.sourceRate);
  const consumeRate = finite(options.consumeRate);
  const fallingBehind = sourceRate > 0 && consumeRate > 0 && consumeRate < sourceRate * 0.9;
  const slowProcessWindow = processP99Ms >= 250;
  const severeSingleLine = maxLineMs >= 1000;
  const slowCheckpointWindow = checkpointP95Ms >= 100;
  const underPressure = backlog >= warningBacklogBytes || fallingBehind || slowProcessWindow || slowCheckpointWindow;

  if (!underPressure) return null;

  const severity = backlog >= criticalBacklogBytes || severeSingleLine || checkpointP95Ms >= 500
    ? "critical"
    : "warning";
  if (fileIo >= 0.45) {
    return {
      severity,
      stage: "python-output-io",
      title: "Python 文件落盘占用主要处理时间",
      evidence: `file I/O=${percent(fileIo)}, backlog=${formatBytes(backlog)}, rawArchive=${ms(durations.raw_archive_write)}, receivedLogs=${ms(durations.raw_input_write)}, event=${ms(durations.event_write)}, outbox=${ms(durations.outbox_write)}`,
      recommendation: "将逐条 open/write/flush/close 改为常驻句柄和批量缓冲；停止每条原始日志重写 raw/index.json，并关闭不需要的原始日志副本。",
    };
  }
  if (parse >= 0.45) {
    return {
      severity,
      stage: "python-parse-cpu",
      title: "Python 日志解析占用主要处理时间",
      evidence: `parse=${percent(parse)}, backlog=${formatBytes(backlog)}, BZSS parse=${ms(durations.bzss_parse)}, matchers=${ms(durations.matchers)}, line avg/p95/p99=${finite(probe.processLineAvgMs).toFixed(1)}/${processP95Ms.toFixed(1)}/${processP99Ms.toFixed(1)}ms, checkpoint p95=${checkpointP95Ms.toFixed(1)}ms`,
      recommendation: "为 BZSS-Core 玩家帧建立快速前缀通道，避免再经过普通 matcher；减少重复正则扫描，必要时拆分独立解析进程。",
    };
  }
  if (read >= 0.45) {
    return {
      severity,
      stage: "python-source-read",
      title: "TailReader 读取与拆行占用主要处理时间",
      evidence: `read=${percent(read)}, backlog=${formatBytes(backlog)}, lines=${finite(probe?.rates?.linesReadPerSec).toFixed(1)}/s, bytes=${formatRate(probe?.rates?.sourceBytesReadPerSec)}`,
      recommendation: "限制单轮读取字节和行数，流式产出记录，避免积压时一次性 read() 全部剩余文件并构建大型列表。",
    };
  }
  if (udp >= 0.35) {
    return {
      severity,
      stage: "python-udp",
      title: "UDP 序列化与发送占用较高",
      evidence: `udp=${percent(udp)}, sends=${finite(probe?.rates?.udpSendsPerSec).toFixed(1)}/s, backlog=${formatBytes(backlog)}`,
      recommendation: "合并小事件、控制玩家帧大小；需要可靠背压时改用本地 TCP/IPC 队列。",
    };
  }
  if (other >= 0.45) {
    return {
      severity,
      stage: "python-other",
      title: "Python 其他同步工作占用主要时间",
      evidence: `other=${percent(other)}, slowest=${slowest}, backlog=${formatBytes(backlog)}, line p95/p99=${processP95Ms.toFixed(1)}/${processP99Ms.toFixed(1)}ms, checkpoint p95=${checkpointP95Ms.toFixed(1)}ms`,
      recommendation: "重点检查控制台逐事件输出、checkpoint 持久化、identity cache 和未被探针单独分类的同步函数。",
    };
  }
  return {
    severity,
    stage: "python-pipeline",
    title: "Python 消费速度低于日志生成速度",
    evidence: `backlog=${formatBytes(backlog)}, input=${formatRate(sourceRate)}, consume=${formatRate(consumeRate)}, max line=${maxLineMs.toFixed(1)}ms`,
    recommendation: "继续观察阶段占比，并对最高耗时函数进行批量化或拆分。",
  };
}

function normalizeOverall(latest) {
  latest.bottlenecks.sort((left, right) => severityRank(right?.severity) - severityRank(left?.severity));
  latest.status = latest.bottlenecks.some((item) => item?.severity === "critical")
    ? "critical"
    : latest.bottlenecks.length
      ? "warning"
      : "healthy";
  latest.headline = latest.bottlenecks[0]?.title ?? "当前未检测到持续性日志摄取瓶颈";
}

function severityRank(value) {
  if (value === "critical") return 2;
  if (value === "warning") return 1;
  return 0;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percent(value) {
  return `${(finite(value) * 100).toFixed(1)}%`;
}

function ms(value) {
  return `${finite(value).toFixed(1)}ms`;
}

function formatRate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${formatBytes(number)}/s` : "--";
}

function formatBytes(value) {
  const bytes = finite(value);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${Math.round(bytes)}B`;
}
