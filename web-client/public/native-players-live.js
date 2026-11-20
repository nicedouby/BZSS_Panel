(() => {
  const target = "formal";
  const list = document.querySelector("#players");
  const status = document.querySelector("#status");
  const refreshButton = document.querySelector("#refresh");
  let snapshot = null;
  let busy = false;
  function node(tag, className, text) {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function statusText(text, kind = "") {
    status.textContent = text;
    status.className = `status ${kind}`.trim();
  }
  function operationId() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { cache: "no-store", credentials: "include", ...options,
      headers: { ...(options.headers || {}) } });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error(`服务器返回了无法读取的响应（HTTP ${response.status}）。`); }
    if (!response.ok) throw new Error(payload?.message || payload?.error || `请求失败（HTTP ${response.status}）。`);
    return payload;
  }
  async function readState() {
    if (busy) return;
    busy = true; refreshButton.disabled = true; statusText("正在读取占位状态…");
    try {
      snapshot = await api(`/api/native-players?target=${target}`);
      render();
      statusText(`已读取 ${(snapshot.players || []).length} 个占位 · ${snapshot.server || "BZSS 正式服"}`, "ready");
    } catch (error) {
      snapshot = null;
      list.replaceChildren(node("p", "empty", error instanceof Error ? error.message : "读取失败。"));
      statusText("无法读取占位状态。", "error");
    } finally { busy = false; refreshButton.disabled = false; }
  }
  function randomRoles(teamId) {
    const roles = snapshot?.roles?.[String(teamId)] || [];
    return roles.filter((role) => !/(^|[_\W])SL(?=$|[_\W])/i.test(role) && !/SQUAD[_ -]?LEADER/i.test(role));
  }
  function render() {
    list.replaceChildren();
    const players = snapshot?.players || [];
    if (!players.length) { list.append(node("p", "empty", "当前没有可管理的登记占位玩家。")); return; }
    for (const player of players) list.append(renderPlayer(player));
  }
  function renderPlayer(player) {
    const card = node("article", "player-card");
    const heading = node("div", "player-heading");
    const identity = node("div", "identity");
    identity.append(node("h2", "player-name", player.name || "未命名占位"));
    identity.append(node("span", "team-tag", `Team ${player.teamId}`));
    heading.append(identity, node("span", "squad", player.squadId ? `小队 ${player.squadId}` : "未加入小队"));
    card.append(heading);
    card.append(node("p", "current-role", `当前兵种：${player.deployRole || player.currentRole || "兵种未设置"}`));
    const available = randomRoles(player.teamId);
    const controls = node("div", "controls");
    const selectLabel = node("label", "role-select-label", "或手动选择");
    const select = node("select", "role-select");
    select.setAttribute("aria-label", `${player.name} 的兵种`);
    select.append(new Option("选择兵种", ""));
    for (const roleId of snapshot?.roles?.[String(player.teamId)] || []) {
      const option = new Option(roleId, roleId);
      if (roleId === player.deployRole || roleId === player.currentRole) option.selected = true;
      select.append(option);
    }
    selectLabel.append(select);
    const manual = node("button", "button secondary", "设置所选兵种");
    manual.type = "button";
    manual.disabled = busy || !player.canControl || !snapshot?.capabilities?.setRole || select.options.length < 2;
    manual.addEventListener("click", () => { if (select.value) void setRole(player, select.value); });
    const random = node("button", "button primary", "随机设置兵种（不含 SL）");
    random.type = "button";
    random.disabled = busy || !player.canControl || !snapshot?.capabilities?.setRole || !available.length;
    random.addEventListener("click", () => {
      if (available.length) void setRole(player, available[Math.floor(Math.random() * available.length)]);
    });
    controls.append(selectLabel, manual, random); card.append(controls);
    if (!available.length) card.append(node("p", "hint", "当前阵营没有可随机分配的非 SL 兵种。"));
    if (!player.canControl || !snapshot?.capabilities?.setRole) card.append(node("p", "hint", "占位或原生兵种接口尚未就绪，请重新读取状态。"));
    return card;
  }
  async function setRole(player, roleId) {
    if (busy || !snapshot || !player.canControl || !snapshot.capabilities?.setRole) return;
    if (!window.confirm(`将占位“${player.name}”设置为 ${roleId}？`)) return;
    busy = true; refreshButton.disabled = true;
    for (const button of list.querySelectorAll("button, select")) button.disabled = true;
    statusText(`正在为 ${player.name} 设置 ${roleId}…`);
    try {
      const result = await api("/api/native-players/set-role", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, operationId: operationId(), epoch: snapshot.epoch,
          playerRef: player.playerRef, roleId }) });
      statusText(result?.applied ? `${player.name} 已设置为 ${roleId}，正在回读确认…` : `设置结果待核对：${player.name} → ${roleId}。`, result?.applied ? "ready" : "error");
      await readAfterWrite();
    } catch (error) {
      statusText(error instanceof Error ? error.message : "设置失败；请重新读取状态核对。", "error");
      await readAfterWrite();
    } finally { busy = false; refreshButton.disabled = false; render(); }
  }
  async function readAfterWrite() {
    try { snapshot = await api(`/api/native-players?target=${target}`); render(); }
    catch { statusText("写入后回读失败，请点击“读取状态”核对结果。", "error"); }
  }
  refreshButton.addEventListener("click", () => void readState());
  void readState();
})();
