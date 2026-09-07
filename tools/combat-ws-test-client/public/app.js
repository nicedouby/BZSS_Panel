const $ = (id) => document.getElementById(id);
let first = true;
async function load() {
  const { options, state } = await fetch("/api/state").then((r) => r.json());
  $("connection").textContent = state.authenticated ? "已认证" : state.connected ? "已连接" : "未连接";
  $("connection").className = `pill ${state.authenticated ? "ok" : ""}`;
  if (first) {
    $("target").value = options.target; $("client").value = options.client; $("delay").value = options.ackDelayMs;
    $("ack").checked = options.autoAck; $("pong").checked = options.autoPong; $("reconnect").checked = options.reconnect; first = false;
  }
  $("metrics").innerHTML = [["接收",state.received],["ACK",state.acked],["重连",state.reconnects],["错误",state.errors.length]].map(([k,v])=>`<article><span>${k}</span><strong>${v}</strong></article>`).join("");
  $("messages").innerHTML = state.messages.map((m)=>`<div class="message ${m.direction}"><time>${m.at}</time><b>${m.direction}</b><pre></pre></div>`).join("");
  [...document.querySelectorAll(".message pre")].forEach((node,i)=>node.textContent=state.messages[i].value);
}
$("apply").onclick = async () => { await fetch("/api/options",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({target:$("target").value,token:$("token").value,client:$("client").value,ackDelayMs:Number($("delay").value),autoAck:$("ack").checked,autoPong:$("pong").checked,reconnect:$("reconnect").checked})}); first=true; load(); };
$("bad").onclick = () => fetch("/api/protocol-error",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({raw:"{broken json"})});
load(); setInterval(load,1000);
