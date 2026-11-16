// SelamPath API base resolver. Loaded before the widget so no inline script is needed.
(function (global) {
  // 1. Explicit value set by the host page before this script loads.
  if (global.SELAMPATH_API_BASE) {
    return;
  }
  // 2. Meta tag override (set content in index.html for production deploys).
  var meta = document.querySelector('meta[name="selampath-api-base"]');
  if (meta && meta.content) {
    global.SELAMPATH_API_BASE = meta.content;
    return;
  }
  var host = global.location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  global.SELAMPATH_API_BASE = isLocal
    ? "http://localhost:8000/api/v1"
    : global.location.origin + "/api/v1";
})(window);
