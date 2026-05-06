// -*- coding: utf-8 -*-

/**
 * DebugPrintPlugin
 *
 * 这是最基础的调试插件。
 *
 * 它监听所有事件 "*"，然后把事件名和参数值输出到控制台。
 * 注意：参数值只显示值，不显示参数名。
 */

function getParamValues(event, maxCount, maxLength) {
  const items = [];

  for (const [key, value] of Object.entries(event)) {
    const match = key.match(/^Param(\d+)_/);
    if (!match) continue;

    items.push({
      index: Number(match[1]),
      value: String(value ?? ""),
    });
  }

  items.sort((a, b) => a.index - b.index);

  const values = items.slice(0, maxCount).map((item) => {
    let text = item.value.trim();

    if (!text) {
      return "-";
    }

    text = text.replace(/\r/g, " ").replace(/\n/g, " ");

    if (text.length > maxLength) {
      text = text.slice(0, maxLength - 1) + "…";
    }

    return text;
  });

  if (items.length > maxCount) {
    values.push(`...+${items.length - maxCount}`);
  }

  return values;
}

export async function register(context) {
  const { eventBus, logger, config } = context;

  const printReceivedEvent = config.console?.printReceivedEvent ?? true;
  const maxParamCount = config.console?.maxParamCount ?? 10;
  const maxParamLength = config.console?.maxParamLength ?? 48;

  const unsubscribe = eventBus.on("*", (event) => {
    if (!printReceivedEvent) {
      return;
    }

    const eventName = event.Event ?? "UnknownEvent";
    const seq = event.Seq ?? "-";
    const values = getParamValues(event, maxParamCount, maxParamLength);
    const paramText = values.length > 0 ? ` | ${values.join(" | ")}` : "";

    logger.event(`${eventName} #${seq}${paramText}`, eventName);
  });

  return {
    name: "DebugPrintPlugin",

    shutdown() {
      unsubscribe();
    },
  };
}
