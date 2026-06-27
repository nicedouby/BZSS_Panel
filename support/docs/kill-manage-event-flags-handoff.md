# KillManage 自动事件标记变更交接说明

适用范围：`modules/kill-manage/index.js` 生成的战斗记录 `record`

版本目的：在不改变现有 UDP 转发和既有战斗事件主结构的前提下，为每条归并后的战斗记录增加“自动事件标记”。

## 1. 这次变更是什么

KillManage 在生成每条战斗记录时，会额外自动计算一组事件标记，用于描述这条记录是否属于特定事件类别。

新增的是记录级别字段，不是玩家档案字段，不写数据库，不改 `player-database`，也不新增 `combat-database`。

## 2. 新增字段

每条 `record` 现在会多出以下字段：

```js
record.eventFlags = []
record.eventFlagLabels = []
```

### 2.1 `eventFlags`

结构化标记数组，便于机器读取。

当前标记对象格式：

```js
{
  key: "give_up" | "friendly_fire" | "self_damage",
  label: "放弃" | "友伤" | "自伤",
  level: "neutral" | "warning" | "danger",
  reason: string
}
```

### 2.2 `eventFlagLabels`

前端或第三方可直接展示的中文标签数组，例如：

```js
["放弃", "友伤"]
```

### 2.3 `tags`

系统会继续保留原有 `record.tags`，并追加事件标记 tag：

```js
event:give_up
event:friendly_fire
event:self_damage
```

这意味着如果第三方当前已经在消费 `tags`，可以不改 UI 就先识别新增事件。

## 3. 第一阶段支持的标记

### 3.1 放弃

- `key`: `give_up`
- `label`: `放弃`
- 条件：
  - `record.type === "died"`
  - `Math.abs(Number(record.damage)) === 300`
- `reason`: `died_damage_300`

说明：
- 这是记录层规则，不依赖管理员手动标记。
- `damage` 只要能转成有限数字即可参与判断。

### 3.2 友伤

- `key`: `friendly_fire`
- `label`: `友伤`
- 条件：
  - `record.isFriendlyFire === true`
- `reason`：
  - 优先使用 `record.friendlyFireReason`
  - 否则默认 `same_team`

说明：
- 友伤标记沿用现有 KillManage 的同队判定结果。
- 不会改变原有 `isFriendlyFire`、`isTeamKill`、`isTeamKillDown` 逻辑。

### 3.3 自伤

- `key`: `self_damage`
- `label`: `自伤`
- 条件：
  - attacker 与 victim 身份相同
- 比较字段：
  - `attackerSteam64ID === victimSteam64ID`
  - `attackerEOSID === victimEOSID`
  - `attackerControllerID === victimControllerID`
  - `attackerName === victimName`
- `reason`: `same_attacker_victim`

说明：
- 如果暂时没有 `victimControllerID`，系统会用已存在字段继续判断。
- 这是“身份一致”规则，不是单纯靠名字判断的业务字段。

## 4. 对第三方对接的影响

### 4.1 当前不会变化的内容

以下内容保持不变：
- UDP 转发结构不变
- 原有 `record` 的主字段不变
- 原有 `record.tags` 仍保留
- `combatResolved`、`friendlyFireResolved`、`teamKillResolved` 事件仍按原逻辑发出
- 不会把这些标记写入玩家表
- 不会新增数据库表
- 不会改玩家档案模块

### 4.2 新增但向后兼容的内容

第三方如果只读取旧字段，仍然可以正常工作。

新增字段是“附加字段”，不是“替换字段”。因此：
- 旧接收方可以忽略 `eventFlags` 和 `eventFlagLabels`
- 新接收方可以优先读取 `eventFlagLabels`
- 机器处理建议读取 `eventFlags`

### 4.3 可能需要兼容的地方

第三方如果做了严格 JSON schema 校验，建议放宽为“允许额外字段”。

第三方如果只依赖 `tags`，建议补充识别：
- `event:give_up`
- `event:friendly_fire`
- `event:self_damage`

第三方如果要显示中文标记栏，建议优先使用：

```js
record.eventFlagLabels || []
```

而不是自己重新推导规则。

第三方如果要做统计分析，建议使用：
- `record.eventFlags[].key` 作为稳定机器键
- `record.eventFlags[].reason` 作为分类原因

不要只依赖 `label`，因为 `label` 主要面向展示。

## 5. 兼容建议

### 5.1 对旧版本接收方

如果第三方还没升级，通常无需改动。

建议确认他们的解析逻辑满足以下条件：
- 可以忽略新增字段
- 不会因为多字段报错
- 不会因为 `tags` 多出 `event:*` 前缀而误判为异常

### 5.2 对新版本接收方

建议按以下优先级读取：

1. 展示类前端优先读取 `record.eventFlagLabels`
2. 规则引擎优先读取 `record.eventFlags`
3. 兼容老逻辑时仍可保留 `record.tags`

### 5.3 对字段缺失的容错

第三方接收时要把下面这些字段视为可选：
- `eventFlags`
- `eventFlagLabels`
- `victimControllerID`

原因：
- 老数据可能没有这些字段
- 某些日志源可能没有完整身份字段

## 6. 示例

### 6.1 放弃示例

```js
{
  type: "died",
  damage: 300,
  eventFlags: [
    {
      key: "give_up",
      label: "放弃",
      level: "neutral",
      reason: "died_damage_300"
    }
  ],
  eventFlagLabels: ["放弃"],
  tags: ["event:give_up"]
}
```

### 6.2 友伤示例

```js
{
  type: "wounded",
  isFriendlyFire: true,
  friendlyFireReason: "same_team",
  eventFlags: [
    {
      key: "friendly_fire",
      label: "友伤",
      level: "warning",
      reason: "same_team"
    }
  ],
  eventFlagLabels: ["友伤"],
  tags: ["friendly_fire", "tk_down", "event:friendly_fire"]
}
```

### 6.3 自伤示例

```js
{
  type: "damaged",
  attackerSteam64ID: "765xxx",
  victimSteam64ID: "765xxx",
  eventFlags: [
    {
      key: "self_damage",
      label: "自伤",
      level: "warning",
      reason: "same_attacker_victim"
    }
  ],
  eventFlagLabels: ["自伤"],
  tags: ["event:self_damage"]
}
```

## 7. 对接方建议动作

建议第三方确认以下几点：

1. 是否直接透传或展示 `record.eventFlagLabels`
2. 是否在规则引擎中增加 `eventFlags[].key` 的识别
3. 是否允许输入结构出现新增字段
4. 是否需要把 `event:*` tag 加入已有标签白名单
5. 是否需要为旧数据补空值兼容

## 8. 本次变更边界

本次只做“事件归类”：
- 只属于单次战斗事件 `record`
- 不改玩家档案
- 不落库
- 不加人工编辑入口
- 不改第三方对接协议的核心事件流

如果后续要增加“载具击杀”“环境死亡”“火箭筒/迫击炮/地雷”等规则，可以继续在 `buildCombatEventFlags()` 中追加，不影响现有对接方式。
