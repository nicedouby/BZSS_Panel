// -*- coding: utf-8 -*-

/**
 * CombatSummaryPlugin
 *
 * 这是一个很小的示例插件。
 *
 * 它不做 TK 判定，也不做处罚。
 * 它只是演示如何订阅事件，并做运行期计数。
 */

export async function register(context) {
  const { eventBus, logger } = context;

  const counters = {
    damaged: 0,
    wounded: 0,
    died: 0,
    spawn: 0,
    squadCreated: 0,
  };

  const unsubscribers = [];

  unsubscribers.push(eventBus.on("On_PlayerDamaged", () => { counters.damaged += 1; }));
  unsubscribers.push(eventBus.on("On_PlayerWounded", () => { counters.wounded += 1; }));
  unsubscribers.push(eventBus.on("On_PlayerDied", () => { counters.died += 1; }));
  unsubscribers.push(eventBus.on("On_PlayerSpawnRequested", () => { counters.spawn += 1; }));
  unsubscribers.push(eventBus.on("On_SquadCreated", () => { counters.squadCreated += 1; }));

  // 每 60 秒输出一次简单统计。
  const timer = setInterval(() => {
    logger.info(
      `Runtime counters: damaged=${counters.damaged}, wounded=${counters.wounded}, died=${counters.died}, spawn=${counters.spawn}, squadCreated=${counters.squadCreated}`
    );
  }, 60_000);

  return {
    name: "CombatSummaryPlugin",

    shutdown() {
      clearInterval(timer);

      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    },
  };
}
