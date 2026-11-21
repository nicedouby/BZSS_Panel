# BZSS-MEM-BRIDGE · Linux

## 使用 3D Viewer

Linux Bridge 和 Panel 的查看器通过 `GET /api/mem-bridge/snapshot` 连接。Bridge 采集只读游戏快照，Viewer 按采样频率更新人物、据点、载具和部署物。查看器入口是 Panel 的「Mem Bridge 3D 查看器」或 `/mem-bridge/3d`，账号需要 `match_state.view`。

先按下面的步骤构建并启动 Bridge，然后在仓库的 `web-client` 目录运行 `npm ci` 和 `npm run build`，再按 Panel 的常规方式启动后端。后端通过回环地址 `127.0.0.1:31903` 访问 Bridge。

用本地有权使用的场景导出作为资产。把地形清单 `terrain.json`、`tiles/` 和建筑 `objects.glb` 放在 `web-client/tactical-models/<地图键>-v2/`。对于 `logar`、`anvil`、`jensens`，现有旧版建筑包放在对应的 `<地图键>-v1/objects.glb`。人物、载具及装备的 GLB 文件与 `catalog-v3.json` 放在 `web-client/public/assets/live-models/` 后重新构建前端。请保持清单与导出文件的相对路径一致。

独立运行的 Squad 内存读取程序，提供地图点位、玩家身份与 Pawn 世界坐标，并尽力从 PlayerState/Health Component 反射读取生命值和战绩。使用 Python 3.11 及以上版本的标准库，无需 pip 包，不导入 BZSS Panel 的任何代码，不依赖占位 SO、RCON、MCSM 或它们的状态文件。

读取使用 Linux `process_vm_readv`。程序没有内存写入、注入、GDB、游戏函数调用、暂停或重启游戏的操作。未来占位功能可在独立模块中扩展；这一版只提供读取接口。

## 当前数据

- 当前 World、地图／图层标识、游戏 PID、进程启动时间、版本 SHA256 和快照 epoch。
- 玩家名字、Player ID、阵营、小队、连接类别、是否有 Pawn、Pawn 类型、位置 X/Y/Z、火力组和兵种（若可反射读取）。
- 战绩字段：击杀、载具击杀、死亡、击倒/受伤、TK、治疗、复苏与各项分数；生命值当前值、上限与百分比。引擎版本或类布局没有对应反射字段时返回 `null` 和 `unknown`，不会填造 0 或 100。
- 普通据点、主基地、出生点和出生组；据点的占领阵营、正在占领阵营、锁定标记和原始占领值；出生点的阵营、启用和围堵状态。
- 位置同时输出 `position`（厘米）和 `positionMeters`（米），均是 UE 世界坐标。相对位置不能代替附着对象的世界位置。
- `positionStatus=no_pawn` 表示没有可读取的士兵实体，不会用 `[0,0,0]` 填充。读取期间对象发生变化时，会标记不可用或丢弃该快照。

玩家分类 `local_controller` 表示没有网络连接的本地 Controller，不能据此证明它一定是占位。当前版本不读取或依赖 Panel 的占位所有权登记，也不生成 Steam／EOS 身份。

地图点位是**当前已加载地图对象**。`componentActive` 不能等同于当前可攻打的 RAAS 目标，因此 `objectiveActive` 暂为 null；没有推测隐藏路线。`capture.percentRaw` 保留引擎原值，不预先假设百分比的范围。

主基地类别同时核对 Main 类和初始阵营，训练场使用相同类的中立测试区域会作为普通区域返回。

## 构建和运行

```sh
python3 build.py
sudo python3 dist/bzss-mem-bridge.pyz --config config.example.json snapshot --target formal
sudo python3 dist/bzss-mem-bridge.pyz --config config.example.json serve
```

`snapshot --output snapshot.json` 可以导出 UTF-8 JSON。压缩包 `dist/bzss-mem-bridge-linux.tar.gz` 包含单文件程序、配置、版本布局和 systemd 示例。程序源代码位于 `bzss_mem_bridge/`。

配置中的目标是固定允许的可执行文件路径，不接受 HTTP 请求提交任意 PID 或内存地址。示例包含 `formal` 和 `test` 两个目标。`profile` 相对于配置文件目录解析，也可使用绝对路径。读取需要 root 或适当的 `CAP_SYS_PTRACE` 权限。

当前布局匹配的游戏 SHA256：`86770cae6d030e37ab9e435e753e7e76ff59e6853190671627af771e02c148d5`。程序还核对了世界坐标 getter 的机器码布局。游戏版本不匹配时返回 `build_mismatch`，不会继续使用旧偏移。

## JSON 接口

默认监听 `127.0.0.1:31903`，只开放本机 GET 接口。位置默认每 0.5 秒采样，生命值和战绩每 1 秒采样，地图对象每 5 秒重新发现；间隔可分别配置。

```sh
curl 'http://127.0.0.1:31903/health'
curl 'http://127.0.0.1:31903/v1/targets'
curl 'http://127.0.0.1:31903/v1/snapshot?target=formal'
curl 'http://127.0.0.1:31903/v1/players?target=formal'
curl 'http://127.0.0.1:31903/v1/map-points?target=formal&kind=capture_zone'
curl 'http://127.0.0.1:31903/v1/map-points?target=test&kind=spawn_point'
curl 'http://127.0.0.1:31903/v1/map?target=formal'
```

HTTP 200 表示当前数据可用；目标未启动、切图或样本过期时返回 503 和 `health.code`，不会把上一张地图的数据作为当前数据返回。所有快照带 epoch，地图／进程身份变化后 epoch 会改变。读取是经过 World 前后校验的非原子采样，并非同一帧的冻结快照。

默认点位类别是 `capture_zone`、`main_base`、`spawn_point`、`spawn_group`。配置中还可以增加 `vehicle_spawner` 或 `deployable_spawner`。`kind` 过滤只对已配置采集的点位生效。

## Linux 服务

`deploy/bzss-mem-bridge.service` 提供 systemd 示例。程序放在 `/opt/bzss-mem-bridge`。从 `config.example.json` 创建 `/etc/bzss-mem-bridge/config.json`，并按实际游戏安装目录设置各目标的可执行文件和版本布局。

```sh
systemctl status bzss-mem-bridge
journalctl -u bzss-mem-bridge -n 30
```
