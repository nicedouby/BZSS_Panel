# 联办名单目录

这个目录中的所有文件都会被 `plugins/lianban-kick.js` 读取。

规则：

- 每行一条记录
- 空行忽略
- 以 `#` 开头的行视为注释
- 支持 `steam:`, `eos:`, `name:` 前缀
- 不写前缀时：
  - 纯数字长 ID 按 `steam`
  - 看起来像 EOS ID 的内容按 `eos`
  - 其他内容按 `name`

示例：

```txt
# Steam64
steam: 76561198000000001

# EOS
eos: 0002b4f0f4e64d62b2f35f0d0b5a1234

# 名字精确匹配
name: 某个玩家
另一个玩家
```
