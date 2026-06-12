(function () {
  var allowedThemes = {
    "default": true,
    "daylight": true,
    "colorful": true,
    "green": true,
  };
  var theme = "default";

  try {
    var raw = window.localStorage && window.localStorage.getItem("bzss.ui.preferences");
    if (raw) {
      var parsed = JSON.parse(raw);
      var savedTheme = String(parsed && parsed.theme || "").trim();
      if (allowedThemes[savedTheme]) {
        theme = savedTheme;
      }
    }
  } catch {}

  document.documentElement.dataset.uiTheme = theme;
})();
