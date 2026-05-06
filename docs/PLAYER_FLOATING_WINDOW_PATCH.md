# Player Floating Window Patch

此补丁只修改“对局状态”里点击玩家名的行为。

## 替换文件

```text
web/pages/match-status.js
```

## 追加 CSS

把以下文件内容追加到 `web/assets/styles.css` 末尾：

```text
web/assets/player-floating-window.patch.css
```

## 修改点

原逻辑：

```js
openDrawer({
  title: `${displayName(player.name)} 详情`,
  body: renderPlayerDrawer(player),
});
```

新逻辑：

```js
openPlayerFloatingWindow(player);
```

## 悬浮窗口显示内容

- 玩家名
- Steam ID
- EOS ID
- Player ID
- Team
- Squad
- 是否队长
- Role
- 状态
- 击杀 / 击倒 / 死亡
- 最后出现时间

Steam/EOS 字段兼容：

```js
player.steamID || player.steam64 || player.SteamID
player.eosID || player.eos || player.EOSID
```

## 关闭方式

- 点击背景
- 点击右上角 ×
- 按 Escape
