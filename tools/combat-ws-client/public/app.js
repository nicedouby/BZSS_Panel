const $ = (id) => document.getElementById(id);
let first = true;
function esc(value) { return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[char]); }
async function load() {
  const { config, state } = await fetch("/api/state").then((r) => r.json());
  $("status").textContent = state.authenticated ? "已认证并接收" : state.connected ? "已连接，等待认证" : "未连接"; $("status").className = `status ${state.authenticated ? "ok" : ""}`;
  if (first) { for (const key of ["websocketUrl", "clientId", "reconnectDelayMs", "outputDirectory"]) $(key).value = config[key] ?? ""; first = false; }
  const metrics = [["数据包", state.packets], ["战斗事件", state.events], ["对局结束", state.matchFinished], ["已 ACK", state.acked], ["重复包", state.duplicates], ["重连", state.reconnects]];
  $("metrics").innerHTML = metrics.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
  $("packets").innerHTML = state.recent.filter((item) => item.kind === "cb" || item.kind === "mf" || item.kind === "error").map((item) => `<article class="packet ${item.kind}"><time>${esc(item.at)}</time><b>${esc(item.kind)}</b><code>${esc(typeof item.data === "string" ? item.data : JSON.stringify(item.data))}</code></article>`).join("") || '<p class="empty">暂未收到数据包。</p>';
}
$("save").onclick = async () => { const payload = Object.fromEntries(["websocketUrl", "clientId", "reconnectDelayMs", "outputDirectory"].map((id) => [id, $(id).value])); if ($("token").value) payload.token = $("token").value; await fetch("/api/config", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) }); $("token").value = ""; first = true; load(); };
$("reconnect").onclick = async () => { await fetch("/api/reconnect", { method:"POST" }); load(); };
load(); setInterval(load, 1000);
