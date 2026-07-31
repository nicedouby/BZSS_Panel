# 小队违规渐进处罚系统

## 范围

第一阶段只处理 `module.squadRestrictionMonitor` 已可靠识别的持续性锁队违规。队名违规、开局建队、阶梯式建队时长、公平建队、小队长时长和兵种/载具使用违规仍由原规则链负责。

监控模块是锁队规则的唯一判定来源。执法模块不复制规则，只消费标准化结果，并在警告或解散前重新调用监控模块确认。

## 处罚时间线

系统只在可信的本局日志时钟达到 300 秒后建立案件：

| 时间 | 操作 |
| --- | --- |
| T+0 | 建立案件，不发送消息 |
| T+30 秒 | 向当前小队长发送第一次警告 |
| T+60 秒 | 向当前小队长发送最后警告 |
| T+90 秒 | 主动刷新小队列表，仍违规才解散 |

所有消息均通过 `AdminWarn` 定向发送，不进行全服广播。

小队整改后进入 `pending_resolution`。连续合规 10 秒后案件才会结束；不足 10 秒再次违规会恢复原案件，原处罚时间不重置。

## 违规锁队规则

| 类型 | 锁队要求 | 违规代码 |
| --- | --- | --- |
| 战斗步兵 `infantry` | 不允许锁队 | `lock_forbidden` |
| MATV、IFV、APC、坦克 | 允许 2—3 人锁队；禁止单人锁队 | `solo_lock_forbidden`、`locked_player_limit_exceeded` |
| 反坦克导弹车、火炮载具、运输/通用直升机、攻击直升机 | 允许 1—3 人锁队 | `locked_player_limit_exceeded` |
| 后勤 `logistics` | 允许 1—6 人锁队 | `locked_player_limit_exceeded` |
| 迫击炮 `mortar` | 允许 1—4 人锁队 | `locked_player_limit_exceeded` |

未锁定、无法分类、没有对应类型规则或已经整改的小队不会自动处罚。

## 安全保护

- 日志时钟没有锚点或处于手动模式时，不建立案件，也不执行已有案件的动作。
- 案件身份由本局、小队槽位、创建者身份和生命周期 `generation` 共同确定。
- 小队消失、换图、换局或相同编号被新创建者复用时，旧案件立即取消。
- 每次警告都会重新确认当前违规，并查找操作时的当前小队长。
- 最终解散前强制刷新 `ListSquads`，再调用监控模块重新判定。
- 解散请求固定使用 `allowUnverifiedTarget: false`。
- 管理员可以取消案件或设置临时豁免。
- 状态使用绝对时间点保存，不依赖多个独立 `setTimeout()`。

## 配置

```json
{
  "modules": {
    "squadRestrictionEnforcement": {
      "enabled": true,
      "enforcementMode": "dry_run",
      "startAfterSeconds": 300,
      "firstWarningDelaySeconds": 30,
      "secondWarningDelaySeconds": 60,
      "disbandDelaySeconds": 90,
      "resolutionConfirmSeconds": 10,
      "schedulerIntervalMs": 1000,
      "requireTrustedRoundClock": true,
      "targetCurrentLeader": true,
      "refreshBeforeDisband": true,
      "recordDirectory": "./data/squad-restriction-enforcement",
      "maxDisbandRetries": 3,
      "disbandRetryDelaySeconds": 5
    }
  }
}
```

模式：

| 模式 | 行为 |
| --- | --- |
| `off` | 不建立案件、不执行动作 |
| `dry_run` | 完整运行状态机并记录模拟动作，不发送 RCON 命令 |
| `warn_only` | 发送两次定向警告，不解散 |
| `enforce` | 发送两次定向警告，持续违规时自动解散 |

首次部署必须从 `dry_run` 开始。确认案件识别、当前队长解析和换局清理均正常后，再依次切换至 `warn_only`、`enforce`。

## 状态与记录接口

模块 API 名为 `squadRestrictionEnforcement`：

- `getState()`：返回模式、可信时钟、执法窗口、活动案件、倒计时、历史和动作记录。
- `getCases({ includeHistory })`：返回活动案件，可选附带历史。
- `getHistory({ limit })`：读取最近完成、取消或失败的案件。
- `getRecords({ limit })`：读取警告、解散、模拟和状态变化记录。
- `cancelCase(caseKey, options)`：管理员取消指定案件。
- `setExemption(caseKey, options)`：为案件身份设置临时豁免。
- `clearExemption(key)`：移除临时豁免。
- `tick()`：立即运行一次调度，主要用于测试和诊断。

管理页面可以使用以下 HTTP API：

- `GET /api/modules/squad-restriction-enforcement/state`
- `POST /api/modules/squad-restriction-enforcement/cases/{caseKey}/cancel`
- `POST /api/modules/squad-restriction-enforcement/cases/{caseKey}/exemption`
- `DELETE /api/modules/squad-restriction-enforcement/cases/{caseKey}/exemption`

取消和豁免操作要求超级管理员权限。

状态持久化到：

```text
data/squad-restriction-enforcement/state.json
```

## 验证

运行专项测试：

```bash
npm run test:squad-restriction-enforcement
```

测试覆盖时间窗口、两次警告、整改、短暂解锁、重新违规、队长更换、小队消失、编号复用、换局、时钟保护、缺失分类、解散前刷新、RCON 重试、重复快照、`dry_run` 和 `warn_only`。
