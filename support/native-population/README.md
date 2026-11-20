# 哨站原生人数接入

入口：本地源码版在 BZSS-Core 菜单“哨站原生人数”；已安装的编译版通过独立模块在 BZSS-Core 旁显示同名按钮。

## 已实现

- 登录和 `bzss_core.use` 权限检查、写入同源检查和操作审计。
- 原生状态、实际真人/占位、配置版本、暂停状态和清空确认。
- 暂停并清空：使用原生 CAS/operation_id 协议，不把配置已接受说成实际已清空。
- 固定占位请求和控件：输入表示固定占位数，直接传给声明支持该语义的后端；没有“真人数+输入”的轮询换算。
- 本地 Unix 代理校验 peer UID、实际进程映射的库 inode/hash 及固定模式验证文件；不提供 shell、路径、进程启动或任意文件写入接口。
- 提交结果未知不重试，前端保留草稿，显式读取状态核对。

## 原生能力边界

当前正式库 `99143250…` 按总人数工作，只允许读取状态和显式暂停。实验库 `9e4129eb…` 还没有完成服务器列表和入场验证，这两个 hash 都被后端明确禁止作为“已验证固定占位”启用。

固定占位“真人进入不退占位，满服真人排队”尚未完成原生端验证。不能通过手改 UI、配置标签或 profile 绕开该限制。当前页面会显示原因并禁用固定占位提交。

只有新的完整实现经隔离验证后，才可为对应 hash 提供 root 管理的 `/etc/bzss-panel-native/fixed-profile.json`：

```json
{"schema":1,"library_sha256":"<经验证的新库的64位sha256>","mode":"fixed_owned","full_policy":"preserve_owned_queue_humans","live_verified":true}
```

库仍须遵循已接入的 broker 配置、CAS、状态协议；协议变化需要一并更新适配器。此验证文件本身不能赋予旧库固定占位能力。

## Linux 接入

在 BZSS Incus 容器内安装 `panel_population_agent.py` 与 service，可用 `sh install-agent.sh`。脚本只安装并启动本地代理，不修改游戏库、启动脚本和游戏配置。固定 broker UID 995 / RPC GID 990，panel 游戏账户为 steam。

代理 socket：`/run/bzss-panel-population/control.sock`。

已编译前端的安装包：本地运行 `node scripts/run-vite.mjs build --config vite.native-population.config.mjs`（web-client 目录），得到 release/native-population-web 中独立 JS/CSS。`deploy_patch.py` 只向现有 backend 与 index 加入此功能，会先备份再检查 Node 语法。完成后仅重启 BZSS Panel MCSM 实例。

## 验证

- `node app/tests/run-native-population-tests.js`：请求校验、未授权拒绝、跨源写入拒绝、CAS 字段、未知结果不重试。
- Linux：`python3 -m unittest discover -s support/native-population -p 'test_*.py' -v`：8 项通过。
- web-client：`npx vitest run src/components/layout/NativePopulationDialog.test.ts src/native-population-entry.test.ts`：5 项通过。
- 完整 Vite 生产构建、独立模块构建通过。全项目 vue-tsc 仍有其他既有页面的类型错误；本次没有改动那些页面来消除错误。

## 本次线上部署（2026-11-12）

容器 `squad-incus-bzss`，panel 目录 `/opt/squad/instances/BZSS`。

原文件备份：`/root/bzss-panel-population-backups/20261112-055705`（文件名时间由远端 UTC 产生）。

仅重启 MCSM `BZSS Panel [Incus]`（uuid `29b0d7a963264b039edc886f98958b7b`）；没有执行游戏实例重启或提交人数设置。

线上已验证：未登录状态 API 返回 401；登录状态 API 返回 200，connected=true，mode=total，fixedOwned=false，pause=true；HTML 加载独立模块，JS/CSS 返回 200。

回退：还原备份中的 web-server.js 和 index.html，重启 panel 实例；如需移除代理，停止并禁用 bzss-panel-population.service。无需改动 SquadGameServer 或其 SO。

## 占位名称与兵种

- 名称池保留 80 个指定名字，并新增中文、英文及中英混合组合生成；游戏中已存在的名字会用于去重，目标上限 99 时仍能生成不重复名字。
- 自动生成名称约 75% 取组合名、25% 取指定名字。
- 新建 Controller 占位会按当前阵营 `DefaultRole` 设置当前及待部署兵种。随机兵种只由面板对单个登记占位显式触发，并从该阵营可用角色中排除 SL；真人玩家不进入占位接口。
- 原生名称生成逻辑在游戏进程启动时加载，因此新名称需在下一次游戏启动后生效。本次没有重启正式服。
