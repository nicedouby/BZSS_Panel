function pick(value, fallback) {
  return value === null || value === undefined ? fallback : value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
  });
}

function readInitialState() {
  var el = document.getElementById("initial-admin-state");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || "null");
  } catch (error) {
    return null;
  }
}

function fmtTime(ms) {
  if (!ms) return "-";
  var date = new Date(Number(ms));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function createAdminClient() {
  var loginCard = document.getElementById("login-card");
  var adminCard = document.getElementById("admin-card");
  var loginForm = document.getElementById("login-form");
  var loginMessage = document.getElementById("login-message");
  var adminMessage = document.getElementById("admin-message");
  var previewCount = document.getElementById("previewCount");
  var previewBtn = document.getElementById("preview-btn");
  var previewMessage = document.getElementById("preview-message");
  var previewSamples = document.getElementById("preview-samples");
  var claimsBody = document.getElementById("claims-body");
  var statsEl = document.getElementById("stats");
  var settingsForm = document.getElementById("settings-form");
  var logoutBtn = document.getElementById("logout-btn");
  var reloadBtn = document.getElementById("reload-btn");
  var initialAdminState = readInitialState();

  function request(path, options) {
    var reqOptions = options || {};
    return fetch(path, {
      cache: "no-store",
      credentials: "include",
      headers: Object.assign({ "Content-Type": "application/json" }, reqOptions.headers || {}),
      method: reqOptions.method || "GET",
      body: reqOptions.body,
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var err = new Error(body.message || body.error || ("Request failed (" + response.status + ")"));
          err.body = body;
          err.response = response;
          throw err;
        }
        return body;
      });
    });
  }

  function renderStats(summary) {
    var data = summary || {};
    statsEl.innerHTML = [
      ["状态", pick(data.enabled ? "启用" : "停用", "-")],
      ["当前记录", pick(data.claimCount, 0)],
      ["有效兑换", pick(data.grantedCount, 0)],
      ["失败记录", pick(data.failedCount, 0)]
    ].map(function (item) {
      return '<div class="stat"><div class="k">' + escapeHtml(item[0]) + '</div><div class="v">' + escapeHtml(item[1]) + '</div></div>';
    }).join("");
  }

  function renderClaims(claims) {
    var list = Array.isArray(claims) ? claims : [];
    claimsBody.innerHTML = list.length > 0 ? list.map(function (item) {
      var statusTag = item.status === "granted" ? "good" : (item.status === "processing" ? "warn" : "bad");
      return [
        "<tr>",
        "<td>" + fmtTime(item.createdAt) + "</td>",
        "<td>" + escapeHtml(item.qqNumber || "-") + "</td>",
        "<td>" + escapeHtml(item.steam64 || "-") + "</td>",
        '<td><span class="tag ' + statusTag + '">' + escapeHtml(item.status || "-") + '</span></td>',
        "<td>" + escapeHtml(item.selectedMode || "-") + "</td>",
        "<td>" + escapeHtml(pick(item.selectedDays, "-")) + "</td>",
        "<td>" + escapeHtml(item.expireAt || "-") + "</td>",
        "<td>" + escapeHtml(item.failureReason || "-") + "</td>",
        "</tr>",
      ].join("");
    }).join("") : '<tr><td colspan="8">暂无记录</td></tr>';
  }

  function renderPreview(result) {
    if (!result) {
      previewMessage.textContent = "点击生成后查看随机分布。";
      previewSamples.innerHTML = "";
      return;
    }

    var summary = result.summary || {};
    previewMessage.textContent = [
      "次数: " + String(pick(result.count, 0)),
      "默认: " + String(pick(summary.defaultCount, 0)),
      "随机: " + String(pick(summary.randomCount, 0)),
      "天数: " + String(pick(summary.minDays, "-")) + " - " + String(pick(summary.maxDays, "-")),
      "平均: " + String(pick(summary.averageDays, "-"))
    ].join("\n");

    var samples = Array.isArray(result.samples) ? result.samples : [];
    previewSamples.innerHTML = samples.length > 0 ? samples.map(function (item) {
      return [
        '<div class="sample-item">',
        '<div><strong>#' + escapeHtml(pick(item.index, "-")) + '</strong> <span class="mini">' + escapeHtml(pick(item.mode, "-")) + '</span></div>',
        '<div>' + escapeHtml(pick(item.days, "-")) + ' 天</div>',
        '</div>'
      ].join("");
    }).join("") : '<div class="sample-item"><div>暂无预览</div><div>-</div></div>';
  }

  function fillSettings(settings) {
    var data = settings || {};
    settingsForm.enabled.checked = Boolean(data.enabled);
    settingsForm.claimEnabled.checked = Boolean(data.claimEnabled);
    settingsForm.defaultDays.value = pick(data.defaultDays, 7);
    settingsForm.randomMinDays.value = pick(data.randomMinDays, 3);
    settingsForm.randomMaxDays.value = pick(data.randomMaxDays, 60);
    settingsForm.defaultWeight.value = pick(data.defaultWeight, 50);
    settingsForm.randomWeight.value = pick(data.randomWeight, 50);
    settingsForm.requiredMatchSeconds.value = pick(data.requiredMatchSeconds, 0);
  }

  function renderAdminState(state) {
    var data = state || {};
    adminMessage.textContent = data.canManage ? "已登录，可管理设置。" : "已登录，但当前账号没有修改设置权限。";
    renderStats(data.summary || {});
    renderClaims(data.claims || []);
    fillSettings(data.settings || {});
    renderPreview(null);
    loginCard.classList.add("hidden");
    adminCard.classList.remove("hidden");
    return data;
  }

  async function loadAdminState() {
    var state = await request("/api/admin/state");
    if (!state.authenticated && !state.user) {
      throw new Error("Not logged in.");
    }
    return renderAdminState(state);
  }

  if (loginForm) {
    loginForm.addEventListener("submit", function () {
      loginMessage.textContent = "登录中...";
    });
  }

  if (settingsForm) {
    settingsForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      adminMessage.textContent = "保存中...";
      try {
        var result = await request("/api/admin/settings", {
          method: "PUT",
          body: JSON.stringify({
            enabled: settingsForm.enabled.checked,
            claimEnabled: settingsForm.claimEnabled.checked,
            defaultDays: Number(settingsForm.defaultDays.value),
            randomMinDays: Number(settingsForm.randomMinDays.value),
            randomMaxDays: Number(settingsForm.randomMaxDays.value),
            defaultWeight: Number(settingsForm.defaultWeight.value),
            randomWeight: Number(settingsForm.randomWeight.value),
            requiredMatchSeconds: Number(settingsForm.requiredMatchSeconds.value),
          }),
        });
        adminMessage.textContent = "已保存。";
        fillSettings(result.settings || {});
        await loadAdminState();
      } catch (error) {
        adminMessage.textContent = error.message || "保存失败";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async function () {
      await request("/api/auth/logout", { method: "POST" }).catch(function () {});
      adminCard.classList.add("hidden");
      loginCard.classList.remove("hidden");
      loginMessage.textContent = "已退出。";
    });
  }

  if (reloadBtn) {
    reloadBtn.addEventListener("click", async function () {
      try {
        await loadAdminState();
      } catch (error) {
        loginCard.classList.remove("hidden");
        adminCard.classList.add("hidden");
        loginMessage.textContent = error.message || "请重新登录";
      }
    });
  }

  if (previewBtn) {
    previewBtn.addEventListener("click", async function () {
      previewMessage.textContent = "生成中...";
      try {
        var count = Number(previewCount.value) || 10;
        var result = await request("/api/admin/random-preview?count=" + encodeURIComponent(count));
        renderPreview(result);
      } catch (error) {
        previewMessage.textContent = error.message || "预览失败";
        previewSamples.innerHTML = "";
      }
    });
  }

  if (initialAdminState) {
    renderAdminState(initialAdminState);
  } else {
    request("/api/auth/session")
      .then(function (session) {
        if (session.authenticated) {
          return loadAdminState();
        }
      })
      .catch(function () {});
  }

  var loginNotice = document.getElementById("login-notice");
  if (loginNotice) {
    loginMessage.textContent = loginNotice.textContent || "登录失败";
  }
}

window.addEventListener("DOMContentLoaded", function () {
  createAdminClient();
});
