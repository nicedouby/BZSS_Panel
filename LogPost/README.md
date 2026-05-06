# BZSS LogParser v3

BZSS Panel 的 Squad 日志采集子系统。

## 本版新增

1. 控制台输出事件时，会显示简洁参数值。
2. 控制台支持 ANSI 彩色输出。
3. 新增只读 LogPost 网页查询器。

## 当前输出事件

- `On_PlayerDamaged`
- `On_PlayerWounded`
- `On_PlayerDied`
- `On_PlayerSpawnRequested`
- `On_SquadCreated`

## 控制台输出配置

```json
"console": {
  "enabled": true,
  "use_color": true,
  "show_params": true,
  "max_params": 8,
  "max_param_chars": 36,
  "show_log_time": true
}
```

输出示例：

```text
[EVENT] On_PlayerDied #12 @2026.05.06-05.30.49:174 | Braovo | -300.000000 | - | - | - | - | - | BP_Soldier_PLA_SquadLeader_Arid_C…
```

控制台只显示参数值，不显示参数名。

## 原始日志保存

默认启用：

```json
"raw_input_log": {
  "enabled": true,
  "output_dir": "./ReceivedLogs",
  "file_name": "Received.log",
  "format": "raw"
}
```

输出位置：

```text
ReceivedLogs/YYYY-MM-DD/Received.log
```

这个文件保存的是 TailReader 实际收到的日志行，独立于事件解析、黑名单、UDP。

## LogPost

解析后的事件会写入：

```text
LogPost/YYYY-MM-DD/All.jsonl
LogPost/YYYY-MM-DD/On_PlayerDied.jsonl
LogPost/YYYY-MM-DD/On_PlayerWounded.jsonl
...
```

## 运行日志解析器

```bash
python main.py
```

或 Windows 直接运行：

```text
run.bat
```

## 运行 LogPost 网页查询器

```bash
python logpost_web_server.py config.json
```

或 Windows 直接运行：

```text
run_logpost_web.bat
```

默认地址：

```text
http://127.0.0.1:7790
```

网页功能：

- 选择日期
- 选择事件文件
- 搜索任意字段 / Raw / 玩家名 / SteamID
- 查看参数值
- 展开完整 JSON

## Web 配置

```json
"logpost_web": {
  "host": "127.0.0.1",
  "port": 7790,
  "output_dir": "./LogPost",
  "max_lines_per_request": 2000
}
```

这个网页只读取 LogPost，不修改任何文件。

## 测试历史日志

将 `Squad.log` 放到项目目录，然后把 `config.json` 改为：

```json
"tail": {
  "from_end": false,
  "reopen_on_truncate": true
}
```

正式运行建议保持：

```json
"from_end": true
```
