// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MODULE_ID = "module.logpostDiagnostics";
const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
const DEFAULT_HISTORY_SIZE = 180;
const PATH_REFRESH_INTERVAL_MS = 10_000;
const PROCESS_REFRESH_INTERVAL_MS = 5_000;

export function createLogpostDiagnosticsModule({ core, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config.get("modules.logpostDiagnostics", {}) ?? {};
  const sampleIntervalMs = Math.max(500, Number(moduleConfig.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS));
  const historySize = Math.max(30, Math.min(900, Number(moduleConfig.historySize ?? DEFAULT_HISTORY_SIZE)));
  const thresholds = {
    sourceBacklogWarningBytes: Math.max(64 * 1024, Number(moduleConfig.sourceBacklogWarningBytes ?? 2 * 1024 * 1024)),
    sourceBacklogCriticalBytes: Math.max(256 * 1024, Number(moduleConfig.sourceBacklogCriticalBytes ?? 16 * 1024 * 1024)),
    bridgeBacklogWarningBytes: Math.max(64 * 1024, Number(moduleConfig.bridgeBacklogWarningBytes ?? 512 * 1024)),
    bridgeBacklogCriticalBytes: Math.max(256 * 1024, Number(moduleConfig.bridgeBacklogCriticalBytes ?? 4 * 1024 * 1024)),
    eventLoopWarningMs: Math.max(10, Number(moduleConfig.eventLoopWarningMs ?? 50)),
    eventLoopCriticalMs: Math.max(25, Number(moduleConfig.eventLoopCriticalMs ?? 200)),
    stalledSeconds: Math.max(2, Number(moduleConfig.stalledSeconds ?? 8)),
  };

  let timer = null;
  let sampling = false;
  let previous = null;
  let latest = null;
  let history = [];
  let paths = null;
  let pathsLoadedAt = 0;
  let processSample = null;
  let processSampleAt = 0;
  let processSamplePrevious = null;
  let externalParserProcess = null;
  let externalParserProcessAt = 0;

  const api = {
    getState() {
      return {
        enabled: true,
        sampleIntervalMs,
        thresholds,
        latest,
        history: [...history],
        paths,
      };
    },
    async sampleNow() {
      await sample();
      return this.getState();
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "LogPost Diagnostics",
      kind: "module",
      version: "1.0.0",
      description: "Measures source-log production, Python parser consumption, LogPost output, file-bridge backlog, UDP delivery, event gaps, process load and Node event-loop pressure.",
    },
    apiName: "logpostDiagnostics",
    api,

    async init() {
      await refreshPaths(true);
    },

    async start() {
      core.webRegistry.registerPage({
        id: "web.logpostDiagnostics",
        title: "LogPost 摄取诊断",
        group: "系统",
        route: "/system/logpost-diagnostics",
        source: MODULE_ID,
        description: "诊断 Squad.log、Python LogPost、JSONL 文件桥、UDP 和 EventBus 各阶段的吞吐、积压与延迟。",
        required: false,
        enabled: true,
        order: 1002,
        icon: "LOG",
        superAdminOnly: true,
      });

      await sample();
      timer = setInterval(() => {
        sample().catch((error) => {
          moduleLogger.warn?.(`LogPost diagnostics sample failed: ${error.message}`);
        });
      }, sampleIntervalMs);
      timer.unref?.();
      moduleLogger.info?.(`[LogPostDiagnostics] started sampleIntervalMs=${sampleIntervalMs}`);
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      sampling = false;
      moduleLogger.info?.("[LogPostDiagnostics] stopped.");
    },
  };

  async function sample() {
    if (sampling) return;
    sampling = true;
    try {
      await refreshPaths(false);
      const now = Date.now();
      const parserManager = core.pythonLogParserManager;
      const managedParserPid = Number(parserManager?.child?.pid ?? 0) || null;
      if (!managedParserPid && (now - externalParserProcessAt >= PROCESS_REFRESH_INTERVAL_MS || !externalParserProcess)) {
        externalParserProcess = await findExternalParserProcess(paths).catch((error) => {
          moduleLogger.debug?.(`[LogPostDiagnostics] external parser discovery failed: ${error.message}`);
          return null;
        });
        externalParserProcessAt = now;
      }
      const parserPid = managedParserPid || Number(externalParserProcess?.pid ?? 0) || null;
      const configuredParserStatus = String(core.webStatus?.state?.pythonLogParser ?? "unknown");
      const parserStatus = managedParserPid
        ? configuredParserStatus
        : parserPid
          ? "running"
          : configuredParserStatus;

      if (parserPid && (now - processSampleAt >= PROCESS_REFRESH_INTERVAL_MS || !processSample)) {
        processSample = await readProcessMetrics(parserPid, processSamplePrevious, now).catch((error) => ({
          pid: parserPid,
          available: false,
          error: error.message,
        }));
        if (processSample?.raw) processSamplePrevious = processSample.raw;
        processSampleAt = now;
      }

      const [sourceStat, parserState, outputStat] = await Promise.all([
        safeStat(paths?.sourceLogPath),
        safeReadJson(paths?.statePath),
        safeStat(resolveOutputEventFile()),
      ]);

      const bridge = core.logPostFileBridge?.getDiagnostics?.()
        ?? core.webStatus?.state?.logPostFileBridgeDiagnostics
        ?? {};
      const udp = core.webStatus?.state?.logPostUdpTransport ?? {};
      const delivery = core.logPostMonitor?.getState?.() ?? {};
      const perf = core.performanceMonitor?.getSnapshot?.()?.latest ?? null;

      const parserOffset = finiteNumber(parserState?.offset, 0);
      const sourceSize = finiteNumber(sourceStat?.size, 0);
      const outputSize = finiteNumber(outputStat?.size, finiteNumber(bridge.currentFileSize, 0));
      const bridgeOffset = finiteNumber(bridge.currentOffset, 0);
      const monitorEvents = finiteNumber(delivery?.metrics?.inspectedEvents, 0);
      const udpPackets = finiteNumber(udp?.packetsReceived, 0);
      const udpBytes = finiteNumber(udp?.bytesReceived, 0);
      const elapsedSeconds = previous ? Math.max(0.001, (now - previous.at) / 1000) : null;

      const rates = {
        sourceProducedBytesPerSec: rate(sourceSize, previous?.sourceSize, elapsedSeconds),
        parserConsumedBytesPerSec: rate(parserOffset, previous?.parserOffset, elapsedSeconds),
        outputProducedBytesPerSec: rate(outputSize, previous?.outputSize, elapsedSeconds),
        bridgeConsumedBytesPerSec: rate(bridgeOffset, previous?.bridgeOffset, elapsedSeconds),
        deliveredEventsPerSec: rate(monitorEvents, previous?.monitorEvents, elapsedSeconds),
        udpPacketsPerSec: rate(udpPackets, previous?.udpPackets, elapsedSeconds),
        udpBytesPerSec: rate(udpBytes, previous?.udpBytes, elapsedSeconds),
      };

      const sourceBacklogBytes = Math.max(0, sourceSize - parserOffset);
      const bridgeBacklogBytes = Math.max(0, outputSize - bridgeOffset);
      const sourceBacklogSeconds = estimateSeconds(sourceBacklogBytes, rates.parserConsumedBytesPerSec);
      const bridgeBacklogSeconds = estimateSeconds(bridgeBacklogBytes, rates.bridgeConsumedBytesPerSec);
      const lastParserProgressAgeSeconds = previous && parserOffset > previous.parserOffset
        ? 0
        : latest?.pipeline?.lastParserProgressAgeSeconds != null
          ? latest.pipeline.lastParserProgressAgeSeconds + (elapsedSeconds ?? 0)
          : 0;
      const lastBridgeProgressAgeSeconds = previous && bridgeOffset > previous.bridgeOffset
        ? 0
        : latest?.pipeline?.lastBridgeProgressAgeSeconds != null
          ? latest.pipeline.lastBridgeProgressAgeSeconds + (elapsedSeconds ?? 0)
          : 0;

      const writeAmplification = estimateWriteAmplification(paths?.parserConfig ?? {});
      const pipeline = {
        sourceFile: {
          path: paths?.sourceLogPath ?? "",
          exists: Boolean(sourceStat),
          sizeBytes: sourceSize,
          modifiedAt: sourceStat?.mtimeMs ? new Date(sourceStat.mtimeMs).toISOString() : "",
          producedBytesPerSec: rates.sourceProducedBytesPerSec,
        },
        parser: {
          status: parserStatus,
          pid: parserPid,
          processSource: managedParserPid ? "node-child" : parserPid ? "external-process" : "none",
          committedOffset: parserOffset,
          sourceSeq: finiteNumber(parserState?.seq, 0),
          mode: String(parserState?.mode ?? ""),
          consumedBytesPerSec: rates.parserConsumedBytesPerSec,
          backlogBytes: sourceBacklogBytes,
          backlogSeconds: sourceBacklogSeconds,
          lastParserProgressAgeSeconds,
          process: stripRawProcessSample(processSample),
        },
        output: {
          path: resolveOutputEventFile(),
          exists: Boolean(outputStat),
          sizeBytes: outputSize,
          producedBytesPerSec: rates.outputProducedBytesPerSec,
          writeAmplification,
        },
        fileBridge: {
          ...bridge,
          backlogBytes: bridgeBacklogBytes,
          backlogSeconds: bridgeBacklogSeconds,
          consumedBytesPerSec: rates.bridgeConsumedBytesPerSec,
          lastBridgeProgressAgeSeconds,
        },
        udp: {
          ...udp,
          packetsPerSec: rates.udpPacketsPerSec,
          bytesPerSec: rates.udpBytesPerSec,
        },
        delivery: {
          ...delivery,
          eventsPerSec: rates.deliveredEventsPerSec,
        },
        node: {
          eventLoopMeanMs: finiteOrNull(perf?.eventLoop?.mean),
          eventLoopP95Ms: finiteOrNull(perf?.eventLoop?.p95),
          eventLoopP99Ms: finiteOrNull(perf?.eventLoop?.p99),
          eventLoopMaxMs: finiteOrNull(perf?.eventLoop?.max),
          rssBytes: finiteOrNull(perf?.memory?.rss),
          heapUsedBytes: finiteOrNull(perf?.memory?.heapUsed),
        },
      };

      const diagnosis = diagnose({
        pipeline,
        rates,
        parserStatus,
        thresholds,
      });

      latest = {
        sampledAt: new Date(now).toISOString(),
        status: diagnosis.status,
        headline: diagnosis.headline,
        bottlenecks: diagnosis.bottlenecks,
        rates,
        pipeline,
      };

      history.push(compactHistoryPoint(latest));
      if (history.length > historySize) {
        history.splice(0, history.length - historySize);
      }

      previous = {
        at: now,
        sourceSize,
        parserOffset,
        outputSize,
        bridgeOffset,
        monitorEvents,
        udpPackets,
        udpBytes,
      };

      core.webStatus?.set?.("logPostDiagnosticsSummary", {
        sampledAt: latest.sampledAt,
        status: latest.status,
        headline: latest.headline,
        sourceBacklogBytes,
        bridgeBacklogBytes,
        eventLoopP95Ms: pipeline.node.eventLoopP95Ms,
        parserStatus,
      });
    } finally {
      sampling = false;
    }
  }

  async function refreshPaths(force) {
    const now = Date.now();
    if (!force && paths && now - pathsLoadedAt < PATH_REFRESH_INTERVAL_MS) return;
    const managerConfig = core.config?.get?.("pythonLogParser", {}) ?? {};
    const workingDirectory = path.resolve(process.cwd(), String(managerConfig.workingDirectory ?? ".").trim());
    const parserConfigPath = path.resolve(workingDirectory, String(managerConfig.configPath ?? "./config.json").trim());
    const parserConfig = await safeReadJson(parserConfigPath) ?? {};
    const outputDirectory = path.resolve(workingDirectory, String(parserConfig.output_dir ?? "./LogPost"));
    const sourceLogPath = path.resolve(workingDirectory, String(parserConfig.log_file ?? "./Squad.log"));
    const statePath = path.resolve(
      workingDirectory,
      String(parserConfig?.tail?.state_path ?? path.join(outputDirectory, ".state", "tailer-state.json")),
    );
    paths = {
      workingDirectory,
      parserConfigPath,
      managerScriptPath: String(managerConfig.scriptPath ?? "./main.py").trim(),
      sourceLogPath,
      outputDirectory,
      statePath,
      parserConfig,
    };
    pathsLoadedAt = now;
  }

  function resolveOutputEventFile() {
    const bridgePath = String(core.logPostFileBridge?.currentFilePath ?? "").trim();
    if (bridgePath) return bridgePath;
    const dateKey = localDateKey(new Date());
    return path.resolve(paths?.outputDirectory ?? process.cwd(), "events", dateKey, "all.jsonl");
  }
}

function diagnose({ pipeline, rates, parserStatus, thresholds }) {
  const bottlenecks = [];
  const add = (severity, stage, title, evidence, recommendation) => {
    bottlenecks.push({ severity, stage, title, evidence, recommendation });
  };

  const sourceBacklog = finiteNumber(pipeline.parser.backlogBytes, 0);
  const bridgeBacklog = finiteNumber(pipeline.fileBridge.backlogBytes, 0);
  const parserRate = finiteNumber(rates.parserConsumedBytesPerSec, 0);
  const sourceRate = finiteNumber(rates.sourceProducedBytesPerSec, 0);
  const bridgeRate = finiteNumber(rates.bridgeConsumedBytesPerSec, 0);
  const outputRate = finiteNumber(rates.outputProducedBytesPerSec, 0);
  const eventLoopP95 = finiteNumber(pipeline.node.eventLoopP95Ms, 0);
  const processCpu = finiteNumber(pipeline.parser.process?.cpuPercent, 0);
  const processWriteRate = finiteNumber(pipeline.parser.process?.writeBytesPerSec, 0);

  if (!["running", "starting"].includes(String(parserStatus).toLowerCase())) {
    add("critical", "python-process", "Python LogPost 未运行", `status=${parserStatus}`, "检查 PythonLogParserManager、脚本路径和进程退出日志。");
  }

  if (sourceBacklog >= thresholds.sourceBacklogCriticalBytes) {
    const likelyDisk = processWriteRate > Math.max(1024 * 1024, parserRate * 0.8);
    const likelyCpu = processCpu >= 75;
    add(
      "critical",
      likelyDisk ? "python-output-io" : likelyCpu ? "python-parse-cpu" : "python-pipeline",
      likelyDisk ? "Python 多文件落盘成为主要瓶颈" : likelyCpu ? "Python 解析 CPU 已接近饱和" : "Python 日志消费速度低于生成速度",
      `source backlog=${formatBytes(sourceBacklog)}, input=${formatRate(sourceRate)}, consume=${formatRate(parserRate)}, cpu=${formatNumber(processCpu)}%, write=${formatRate(processWriteRate)}`,
      likelyDisk
        ? "减少逐行 open/flush、关闭不必要的 raw archive/ReceivedLogs/outbox 副本，并改为批量缓冲写入。"
        : likelyCpu
          ? "将 BZSS-Core 大帧解析拆分或迁移到独立解析进程/线程，并减少重复正则扫描。"
          : "检查 Python 是否卡在文件写入、控制台输出或同步网络发送。",
    );
  } else if (sourceBacklog >= thresholds.sourceBacklogWarningBytes || (sourceRate > 0 && parserRate > 0 && parserRate < sourceRate * 0.9)) {
    add(
      "warning",
      "python-pipeline",
      "Python 消费能力接近日志生成上限",
      `source backlog=${formatBytes(sourceBacklog)}, input=${formatRate(sourceRate)}, consume=${formatRate(parserRate)}`,
      "观察积压是否连续增长；优先减少原始日志复制和逐条 flush。",
    );
  }

  if (pipeline.parser.lastParserProgressAgeSeconds >= thresholds.stalledSeconds && sourceBacklog > 0) {
    add(
      "critical",
      "python-stalled",
      "Python 读取游标停止推进",
      `stalled=${formatNumber(pipeline.parser.lastParserProgressAgeSeconds)}s, backlog=${formatBytes(sourceBacklog)}`,
      "检查 LogPost 进程堆栈、磁盘响应、控制台阻塞和单条超大日志。",
    );
  }

  if (bridgeBacklog >= thresholds.bridgeBacklogCriticalBytes) {
    add(
      "critical",
      "node-file-bridge",
      "Node FileBridge 严重积压",
      `backlog=${formatBytes(bridgeBacklog)}, output=${formatRate(outputRate)}, consume=${formatRate(bridgeRate)}, theoretical=${formatRate(pipeline.fileBridge.theoreticalMaxBytesPerSec)}`,
      "提高单次读取预算或改为流式读取；避免在每条 JSONL 上同步解析并立即广播所有事件。",
    );
  } else if (bridgeBacklog >= thresholds.bridgeBacklogWarningBytes || (outputRate > 0 && bridgeRate > 0 && bridgeRate < outputRate * 0.9)) {
    add(
      "warning",
      "node-file-bridge",
      "FileBridge 消费速度接近输出速度",
      `backlog=${formatBytes(bridgeBacklog)}, output=${formatRate(outputRate)}, consume=${formatRate(bridgeRate)}`,
      "继续观察积压趋势；当前桥接器每轮只读取一个 256KB 分块。",
    );
  }

  if (finiteNumber(pipeline.fileBridge.overlappingTickSkips, 0) > 0) {
    add(
      "warning",
      "node-file-bridge",
      "FileBridge 轮询发生重叠",
      `overlap skips=${pipeline.fileBridge.overlappingTickSkips}, last tick=${formatNumber(pipeline.fileBridge.lastTickDurationMs)}ms`,
      "说明单轮读取和事件广播超过轮询周期，应减少每条事件的同步工作。",
    );
  }

  if (eventLoopP95 >= thresholds.eventLoopCriticalMs) {
    add("critical", "node-main-thread", "Node 主线程严重阻塞", `eventLoop p95=${formatNumber(eventLoopP95)}ms`, "将大 JSON/正则解析和批量状态构建迁出主线程，降低单次广播规模。");
  } else if (eventLoopP95 >= thresholds.eventLoopWarningMs) {
    add("warning", "node-main-thread", "Node 主线程存在明显延迟", `eventLoop p95=${formatNumber(eventLoopP95)}ms`, "检查 BZSS-Core 帧解析、FileBridge JSON.parse 和 EventBus 订阅者耗时。");
  }

  if (finiteNumber(pipeline.delivery?.metrics?.eventGapCount, 0) > 0) {
    add(
      "warning",
      "transport",
      "检测到 LogPost 业务事件序号缺口",
      `event gaps=${pipeline.delivery.metrics.eventGapCount}`,
      "对照 UDP invalid/oversized 计数；高频场景建议使用有背压能力的本地 IPC/TCP，而不是仅依赖 UDP。",
    );
  }

  if (finiteNumber(pipeline.udp.invalidJson, 0) > 0 || finiteNumber(pipeline.udp.oversizedMessages, 0) > 0) {
    add(
      "warning",
      "udp",
      "UDP 输入存在无效或超大数据包",
      `invalid=${pipeline.udp.invalidJson ?? 0}, oversized=${pipeline.udp.oversizedMessages ?? 0}`,
      "检查 BZSS-Core 玩家帧大小和 maxMessageBytes；大帧应分块并带序号重组。",
    );
  }

  bottlenecks.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const status = bottlenecks.some((item) => item.severity === "critical")
    ? "critical"
    : bottlenecks.length
      ? "warning"
      : "healthy";
  const headline = bottlenecks[0]?.title ?? "当前未检测到持续性日志摄取瓶颈";
  return { status, headline, bottlenecks };
}

function compactHistoryPoint(latest) {
  return {
    sampledAt: latest.sampledAt,
    status: latest.status,
    sourceProducedBytesPerSec: latest.rates.sourceProducedBytesPerSec,
    parserConsumedBytesPerSec: latest.rates.parserConsumedBytesPerSec,
    outputProducedBytesPerSec: latest.rates.outputProducedBytesPerSec,
    bridgeConsumedBytesPerSec: latest.rates.bridgeConsumedBytesPerSec,
    deliveredEventsPerSec: latest.rates.deliveredEventsPerSec,
    sourceBacklogBytes: latest.pipeline.parser.backlogBytes,
    bridgeBacklogBytes: latest.pipeline.fileBridge.backlogBytes,
    eventLoopP95Ms: latest.pipeline.node.eventLoopP95Ms,
    parserCpuPercent: latest.pipeline.parser.process?.cpuPercent ?? null,
    parserWriteBytesPerSec: latest.pipeline.parser.process?.writeBytesPerSec ?? null,
  };
}

function estimateWriteAmplification(parserConfig) {
  const transportOnly = Boolean(parserConfig?.transport_only ?? false);
  const storage = parserConfig?.storage ?? {};
  const rawInput = parserConfig?.raw_input_log ?? {};
  if (transportOnly) {
    return { transportOnly: true, rawCopiesPerLine: 0, matchedEventWrites: 0, notes: ["transport_only=true：不写 LogPost 文件，仅 UDP 转发。"] };
  }
  const rawCopiesPerLine = Number(Boolean(storage.write_v2_raw_archive ?? true))
    + Number(Boolean(storage.write_legacy_raw_archive ?? false))
    + Number(Boolean(rawInput.enabled ?? true));
  const eventCopies = Number(Boolean(storage.write_v2_events ?? true)) * 2
    + Number(Boolean(storage.write_legacy_events ?? false)) * 2;
  // pending + send_attempted outbox records are written for every matched event.
  const matchedEventWrites = eventCopies + 2;
  const notes = [];
  if (storage.write_v2_raw_archive ?? true) notes.push("每条原始日志写 raw segment，并重写 raw index.json。各写入当前均逐条 open/flush/close。");
  if (rawInput.enabled ?? true) notes.push("每条原始日志额外写 ReceivedLogs。当前逐条 open/flush/close。");
  if (matchedEventWrites >= 4) notes.push(`每个匹配事件至少触发约 ${matchedEventWrites} 次文件追加。`);
  return { transportOnly: false, rawCopiesPerLine, matchedEventWrites, notes };
}

async function readProcessMetrics(pid, previousRaw, now) {
  if (process.platform === "win32") {
    const script = [
      `$p = Get-Process -Id ${pid} -ErrorAction Stop;`,
      `$w = Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\";`,
      `[pscustomobject]@{pid=$p.Id;cpuSeconds=[double]$p.CPU;workingSetBytes=[double]$p.WorkingSet64;privateBytes=[double]$p.PrivateMemorySize64;handles=[double]$p.HandleCount;readBytes=[double]$w.ReadTransferCount;writeBytes=[double]$w.WriteTransferCount} | ConvertTo-Json -Compress`,
    ].join(" ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const raw = { ...JSON.parse(stdout.trim()), sampledAt: now };
    return deriveProcessRates(raw, previousRaw);
  }

  if (process.platform === "linux") {
    const [status, io] = await Promise.all([
      fs.readFile(`/proc/${pid}/status`, "utf8"),
      fs.readFile(`/proc/${pid}/io`, "utf8"),
    ]);
    const workingSetKb = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0);
    const readBytes = Number(/^read_bytes:\s+(\d+)/m.exec(io)?.[1] ?? 0);
    const writeBytes = Number(/^write_bytes:\s+(\d+)/m.exec(io)?.[1] ?? 0);
    const raw = { pid, workingSetBytes: workingSetKb * 1024, privateBytes: null, handles: null, readBytes, writeBytes, cpuSeconds: null, sampledAt: now };
    return deriveProcessRates(raw, previousRaw);
  }

  return { pid, available: false, error: `Process metrics unsupported on ${process.platform}` };
}

/**
 * LogPost may intentionally run as a separately managed process. In that mode
 * PythonLogParserManager is disabled, so its WebStatus value cannot be used as
 * the health signal for the diagnostics page. Identify the external process by
 * its script/config arguments instead.
 */
async function findExternalParserProcess(paths) {
  if (!paths?.workingDirectory || !paths?.parserConfigPath) return null;

  const expectedScript = path.resolve(paths.workingDirectory, String(paths.managerScriptPath ?? "./main.py"));
  const expectedConfig = path.resolve(paths.parserConfigPath);
  const scriptName = path.basename(expectedScript).toLowerCase();
  const configName = path.basename(expectedConfig).toLowerCase();
  const workingDirectory = normalizeProcessPath(paths.workingDirectory);
  const scriptPath = normalizeProcessPath(expectedScript);
  const configPath = normalizeProcessPath(expectedConfig);

  const candidates = process.platform === "win32"
    ? await listWindowsPythonProcesses()
    : await listUnixPythonProcesses();

  for (const candidate of candidates) {
    const commandLine = normalizeProcessPath(candidate.commandLine);
    if (!commandLine) continue;
    const isPython = /(?:^|[\\/\s])python(?:\.exe)?(?:\s|$)/i.test(candidate.name || "")
      || /(?:^|[\\/\s])python(?:\d+(?:\.\d+)*)?(?:\.exe)?(?:\s|$)/i.test(commandLine);
    if (!isPython) continue;

    const scriptMatches = commandLine.includes(scriptPath)
      || commandLine.includes(`${path.sep}${scriptName}`)
      || commandLine.includes(`/${scriptName}`)
      || commandLine.includes(` ${scriptName}`);
    const configMatches = commandLine.includes(configPath)
      || commandLine.includes(`${path.sep}${configName}`)
      || commandLine.includes(`/${configName}`)
      || commandLine.includes(` ${configName}`);
    const cwdMatches = !candidate.cwd || normalizeProcessPath(candidate.cwd) === workingDirectory;
    if (scriptMatches && (configMatches || cwdMatches)) {
      return { pid: Number(candidate.pid), commandLine: candidate.commandLine, source: "external-process" };
    }
  }
  return null;
}

async function listWindowsPythonProcesses() {
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 3000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const parsed = JSON.parse(stdout.trim() || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
    pid: Number(item.ProcessId),
    name: String(item.Name ?? ""),
    commandLine: String(item.CommandLine ?? ""),
  })).filter((item) => item.pid > 0);
}

async function listUnixPythonProcesses() {
  const entries = await fs.readdir("/proc", { withFileTypes: true });
  const processes = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    try {
      const commandLine = (await fs.readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim();
      const name = await fs.readFile(`/proc/${pid}/comm`, "utf8").catch(() => "");
      const cwd = await fs.realpath(`/proc/${pid}/cwd`).catch(() => "");
      processes.push({ pid, name: name.trim(), commandLine, cwd });
    } catch {
      // Processes can disappear between readdir() and the /proc reads.
    }
  }
  return processes;
}

function normalizeProcessPath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replaceAll(/\/+/g, "/").toLowerCase();
}

function deriveProcessRates(raw, previous) {
  const elapsedSeconds = previous?.sampledAt ? Math.max(0.001, (raw.sampledAt - previous.sampledAt) / 1000) : null;
  const cpuPercent = raw.cpuSeconds != null && previous?.cpuSeconds != null && elapsedSeconds
    ? Math.max(0, ((raw.cpuSeconds - previous.cpuSeconds) / elapsedSeconds) * 100)
    : null;
  return {
    raw,
    pid: raw.pid,
    available: true,
    cpuPercent,
    workingSetBytes: finiteOrNull(raw.workingSetBytes),
    privateBytes: finiteOrNull(raw.privateBytes),
    handles: finiteOrNull(raw.handles),
    readBytesPerSec: rate(raw.readBytes, previous?.readBytes, elapsedSeconds),
    writeBytesPerSec: rate(raw.writeBytes, previous?.writeBytes, elapsedSeconds),
  };
}

function stripRawProcessSample(value) {
  if (!value) return null;
  const { raw, ...rest } = value;
  return rest;
}

async function safeReadJson(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function safeStat(filePath) {
  if (!filePath) return null;
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function rate(current, previous, elapsedSeconds) {
  if (!elapsedSeconds || previous == null) return null;
  const delta = Number(current) - Number(previous);
  if (!Number.isFinite(delta)) return null;
  return Math.max(0, delta) / elapsedSeconds;
}

function estimateSeconds(backlog, throughput) {
  if (!Number.isFinite(backlog) || backlog <= 0) return 0;
  if (!Number.isFinite(throughput) || throughput <= 0) return null;
  return backlog / throughput;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function severityRank(value) {
  if (value === "critical") return 2;
  if (value === "warning") return 1;
  return 0;
}

function localDateKey(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatBytes(value) {
  const bytes = Math.max(0, finiteNumber(value, 0));
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${Math.round(bytes)}B`;
}

function formatRate(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${formatBytes(value)}/s`;
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return Number(value).toFixed(1);
}
