// -*- coding: utf-8 -*-

let latestResult = null;

export async function renderPage({ root, api, apiFetch, routeInfo }) {
  const initialName = String(routeInfo?.params?.get("name") || routeInfo?.params?.get("squadName") || "").trim();

  root.innerHTML = `
    <section class="page squad-name-classifier-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">队名判定</div>
          <div class="page-subtitle">输入小队名称，查看系统会把它归类为步兵队、载具队、支援队或其他。</div>
        </div>
        <div class="console-actions">
          <button class="ghost-btn" type="button" data-sample="步兵队">步兵队</button>
          <button class="ghost-btn" type="button" data-sample="载具队">载具队</button>
          <button class="ghost-btn" type="button" data-sample="支援队">支援队</button>
          <button class="ghost-btn" type="button" data-sample="Squad 3">默认队名</button>
        </div>
      </div>

      <div class="grid cols-2 squad-name-grid">
        <section class="card">
          <div class="page-title-row">
            <div>
              <div class="page-title">输入</div>
              <div class="page-subtitle">支持 GET / POST 调试接口。</div>
            </div>
          </div>

          <form id="squad-name-form" class="squad-name-form">
            <label class="field-label" for="squad-name-input">队名</label>
            <div class="squad-name-input-row">
              <input
                id="squad-name-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="例如：步兵队 / 载具队 / 支援队 / Squad 3"
                value="${escAttr(initialName || "步兵队")}"
              >
              <button id="squad-name-submit" type="submit">开始判定</button>
            </div>
            <div class="match-empty" style="margin-top: 10px;">结果会显示命中的规则、归类标签和完整 JSON。</div>
          </form>
        </section>

        <section class="card">
          <div class="page-title-row">
            <div>
              <div class="page-title">结果</div>
              <div class="page-subtitle" id="squad-name-result-subtitle">等待输入队名</div>
            </div>
            <span id="squad-name-category" class="status-text" data-tone="idle">未判定</span>
          </div>

          <div id="squad-name-error" class="error-box" hidden></div>
          <div id="squad-name-metrics" class="squad-name-metrics" hidden></div>
          <pre id="squad-name-json" class="squad-name-json" hidden></pre>
          <div id="squad-name-empty" class="match-empty">还没有判定结果。输入队名后点击“开始判定”。</div>
        </section>
      </div>

      <section class="card">
        <div class="page-title-row">
          <div>
            <div class="page-title">规则提示</div>
            <div class="page-subtitle">这个页面直接展示后端默认规则的命中逻辑。</div>
          </div>
        </div>
        <div class="squad-name-rules">
          <article class="rule-card infantry">
            <strong>步兵队</strong>
            <p>默认队名、步兵白名单，或包含“步兵”“空突”“轻步”等关键字。</p>
          </article>
          <article class="rule-card vehicle">
            <strong>载具队</strong>
            <p>载具白名单，或包含“载具”“装甲”“坦克”“战车”“直升机”“炮车”等关键字。</p>
          </article>
          <article class="rule-card support">
            <strong>支援队</strong>
            <p>支援白名单，或包含“支援”“后勤”“维修”“医疗”“补给”“炮兵”等关键字。</p>
          </article>
          <article class="rule-card other">
            <strong>其他</strong>
            <p>未命中规则，或先命中了黑名单。</p>
          </article>
        </div>
      </section>
    </section>
  `;

  const form = root.querySelector("#squad-name-form");
  const input = root.querySelector("#squad-name-input");
  const submitButton = root.querySelector("#squad-name-submit");
  const errorBox = root.querySelector("#squad-name-error");
  const subtitle = root.querySelector("#squad-name-result-subtitle");
  const category = root.querySelector("#squad-name-category");
  const metrics = root.querySelector("#squad-name-metrics");
  const json = root.querySelector("#squad-name-json");
  const empty = root.querySelector("#squad-name-empty");

  function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    input.disabled = isLoading;
    submitButton.textContent = isLoading ? "判定中..." : "开始判定";
  }

  function renderResult(result) {
    latestResult = result;
    errorBox.hidden = true;
    errorBox.textContent = "";
    empty.hidden = true;
    metrics.hidden = false;
    json.hidden = false;

    subtitle.textContent = `输入：${result.rawName || "空"}`;
    category.textContent = result.label || "未判定";
    category.dataset.tone = result.category === "infantry"
      ? "success"
      : result.category === "vehicle"
        ? "pending"
        : result.category === "warn";

    metrics.innerHTML = `
      <div class="metric">
        <span>归类</span>
        <strong>${esc(result.label || "--")}</strong>
      </div>
      <div class="metric">
        <span>规则</span>
        <strong>${esc(result.matchedRule || "--")}</strong>
      </div>
      <div class="metric">
        <span>命中值</span>
        <strong>${esc(result.matchedValue || "--")}</strong>
      </div>
      <div class="metric">
        <span>标准化</span>
        <strong>${esc(result.normalizedName || "--")}</strong>
      </div>
    `;
    json.textContent = JSON.stringify(result, null, 2);
  }

  function showError(message) {
    latestResult = null;
    errorBox.hidden = false;
    errorBox.textContent = message;
    metrics.hidden = true;
    json.hidden = true;
    empty.hidden = false;
    category.textContent = "判定失败";
    category.dataset.tone = "error";
    subtitle.textContent = "请求接口时发生错误";
  }

  async function classify() {
    const name = String(input.value || "").trim();
    if (!name) return;

    setLoading(true);
    errorBox.hidden = true;
    try {
      const response = await apiPost(apiFetch, "/api/squad-name/classify", { name });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.message || `请求失败 (${response.status})`);
      }
      renderResult(data);
    } catch (error) {
      const message = error?.message || "队名判定失败";
      showError(message);
    } finally {
      setLoading(false);
    }
  }

  if (initialName) {
    input.value = initialName;
    await classify();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    classify().catch(() => {});
  });

  root.querySelectorAll("[data-sample]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.sample || "";
      classify().catch(() => {});
    });
  });

  return () => {
    latestResult = null;
  };
}

async function apiPost(apiFetch, path, body = {}, options = {}) {
  return await apiFetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      ...options,
    });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c]));
}

function escAttr(value) {
  return esc(value).replace(/`/g, "&#96;");
}
