function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderFatalBootError(error: unknown) {
  const root = document.querySelector("#app");
  if (!root) return;

  const message = error instanceof Error
    ? `${error.name}: ${error.message}\n\n${error.stack ?? ""}`.trim()
    : String(error ?? "Unknown startup error");

  root.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#06090f;color:#f4f8fb;font-family:'Segoe UI Variable Text','Segoe UI',sans-serif;">
      <div style="width:min(860px,100%);border:1px solid rgba(248,113,113,0.32);border-radius:20px;background:rgba(20,24,32,0.92);box-shadow:0 20px 60px rgba(0,0,0,0.35);padding:24px;">
        <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#fca5a5;margin-bottom:10px;">Frontend Startup Failed</div>
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;">页面启动失败</h1>
        <p style="margin:0 0 16px;color:#cbd5e1;line-height:1.7;">这不是网络层 404。前端在初始化阶段抛出了未处理异常，面板没有完成挂载。</p>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;border-radius:14px;background:#0b1220;padding:16px;color:#fecaca;border:1px solid rgba(248,113,113,0.2);">${escapeHtml(message)}</pre>
      </div>
    </div>
  `;
}
