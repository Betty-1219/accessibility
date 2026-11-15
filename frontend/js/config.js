// SelamPath API base resolver. Loaded before the widget so no inline script is needed.
(function (global) {
  // Respect an explicit value set by the host page before this script loads.
  if (global.SELAMPATH_API_BASE) {
    return;
  }
  var host = global.location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  global.SELAMPATH_API_BASE = isLocal
    ? "http://localhost:8000/api/v1"
    : global.location.origin + "/api/v1";
})(window);
