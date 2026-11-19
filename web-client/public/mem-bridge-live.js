const $ = (id) => document.getElementById(id);
const target = $('target');
const statusNode = $('status');
const summaryNode = $('summary');
const playersNode = $('players');
const sampleNode = $('sample-time');
const unknown = '未知';
const show = (value) => value === null || value === undefined || value === '' || !Number.isFinite(typeof value === 'number' ? value : Number(value)) ? unknown : String(value);
const fmt = (value, digits = 0) => value === null || value === undefined || !Number.isFinite(Number(value)) ? unknown : Number(value).toFixed(digits);
function setCell(row, value, className = '') { const cell = document.createElement('td'); cell.textContent = value; if (className) cell.className = className; row.append(cell); }
function metric(label, value, hint = '') { const node = document.createElement('div'); node.className = 'metric'; const title = document.createElement('span'); title.textContent = label; const number = document.createElement('strong'); number.textContent = value; const note = document.createElement('small'); note.textContent = hint; node.append(title, number, note); return node; }
function render(data) {
  const players = Array.isArray(data.players) ? data.players : [];
  const withPosition = players.filter((p) => p.positionStatus === 'ok' && p.positionMeters).length;
  const withHealth = players.filter((p) => p.vitals?.percent != null).length;
  const health = data.health?.status === 'ok' ? '正常' : (data.health?.message || '异常');
  summaryNode.replaceChildren(metric('Memory Bridge', data.version || unknown, data.target === 'test' ? '测试服' : '正式服'), metric('地图', data.map?.mapName || data.map?.worldName || unknown, data.map?.worldName || ''), metric('玩家对象', String(players.length), `有位置 ${withPosition} · 有生命值 ${withHealth}`), metric('读取状态', health, data.health?.status === 'ok' ? '快照可用' : (data.health?.code || '')));
  playersNode.replaceChildren();
  if (!players.length) { const row = document.createElement('tr'); const empty = document.createElement('td'); empty.colSpan = 8; empty.className = 'empty'; empty.textContent = '当前快照没有玩家对象'; row.append(empty); playersNode.append(row); return; }
  for (const player of players) {
    const row = document.createElement('tr');
    setCell(row, `${player.name || '未命名'}${player.playerId == null ? '' : ` · ID ${player.playerId}`}`, 'player-name');
    setCell(row, `Team ${show(player.teamId)} / Squad ${show(player.squadId)}`);
    setCell(row, player.role || unknown);
    const pos = player.positionStatus === 'ok' ? player.positionMeters : null;
    setCell(row, pos ? `${fmt(pos.x,1)}, ${fmt(pos.y,1)}, ${fmt(pos.z,1)}` : '未知');
    const vitals = player.vitals || {};
    setCell(row, vitals.percent == null ? unknown : `${fmt(vitals.percent)}%${vitals.current == null ? '' : ` (${fmt(vitals.current)}/${fmt(vitals.maximum)})`}`);
    const combat = player.combat || {};
    setCell(row, `${show(combat.kills)} / ${show(combat.deaths)} / ${show(combat.woundeds)}`);
    setCell(row, `${show(combat.teamKills)} / ${show(combat.revives)}`);
    const state = player.hasPawn ? '有 Pawn' : '无 Pawn';
    setCell(row, `${state} · ${player.connectionKind || unknown}${player.combatStatus && player.combatStatus !== 'ok' ? ` · 战绩 ${player.combatStatus}` : ''}`);
    playersNode.append(row);
  }
}
async function refresh() {
  $('refresh').disabled = true;
  try {
    const response = await fetch(`/api/mem-bridge/snapshot?target=${encodeURIComponent(target.value)}`, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    if (data.module !== 'BZSS-MEM-BRIDGE' || data.target !== target.value || !Array.isArray(data.players)) throw new Error('Bridge 返回的数据格式不匹配');
    render(data);
    const at = Number(data.observedAt);
    const time = Number.isFinite(at) ? new Date(at * 1000).toLocaleTimeString() : '时间未知';
    sampleNode.textContent = `采样 ${time}`;
    statusNode.textContent = `${data.target === 'test' ? '测试服' : '正式服'} · ${data.health?.status === 'ok' ? '数据正常' : (data.health?.message || '数据异常')}`;
    statusNode.className = `status ${data.health?.status === 'ok' ? 'ok' : 'warn'}`;
  } catch (error) { statusNode.textContent = error instanceof Error ? error.message : String(error); statusNode.className = 'status warn'; }
  finally { $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', () => void refresh());
target.addEventListener('change', () => void refresh());
void refresh();
window.setInterval(() => void refresh(), 2000);
