(function initUrlNormalizer(globalScope) {
  if (globalScope.GladiumUrlNormalizer) {
    return;
  }

  var NUMERIC_RE = /^\d+$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HEX_RE = /^[0-9a-f]{8,}$/i;
  var LONG_ALNUM_RE = /^[A-Za-z0-9_-]{16,}$/;
  var PLACEHOLDER = ":id";

  function isDynamicSegment(segment) {
    if (segment.length === 0) {
      return false;
    }

    if (NUMERIC_RE.test(segment)) {
      return true;
    }

    if (UUID_RE.test(segment)) {
      return true;
    }

    if (HEX_RE.test(segment) && !/^[a-z]+$/i.test(segment)) {
      return true;
    }

    if (LONG_ALNUM_RE.test(segment) && /\d/.test(segment)) {
      return true;
    }

    return false;
  }

  function normalizePath(pathname) {
    var segments = pathname.split("/");
    var normalized = [];

    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      if (segment.length === 0) {
        normalized.push(segment);
        continue;
      }

      normalized.push(isDynamicSegment(segment) ? PLACEHOLDER : segment);
    }

    return normalized.join("/");
  }

  function normalizeQueryKeys(search) {
    if (typeof search !== "string" || search.length === 0) {
      return "";
    }

    var raw = search.charAt(0) === "?" ? search.slice(1) : search;
    if (raw.length === 0) {
      return "";
    }

    var pairs = raw.split("&");
    var keys = [];

    for (var i = 0; i < pairs.length; i++) {
      var eq = pairs[i].indexOf("=");
      var key = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      if (key.length > 0) {
        keys.push(key);
      }
    }

    keys.sort();

    var unique = [];
    for (var j = 0; j < keys.length; j++) {
      if (j === 0 || keys[j] !== keys[j - 1]) {
        unique.push(keys[j]);
      }
    }

    if (unique.length === 0) {
      return "";
    }

    return "?" + unique.join("&");
  }

  function normalizeUrl(url) {
    if (typeof url !== "string" || url.length === 0) {
      return null;
    }

    try {
      var parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }

      var path = normalizePath(parsed.pathname);
      var query = normalizeQueryKeys(parsed.search);
      return parsed.protocol + "//" + parsed.host + path + query;
    } catch (e) {
      return null;
    }
  }

  function endpointKey(method, url) {
    var m = typeof method === "string" && method.length > 0
      ? method.toUpperCase()
      : "GET";
    var normalized = normalizeUrl(url);

    if (normalized === null) {
      return m + " " + (typeof url === "string" ? url : "(unknown)");
    }

    return m + " " + normalized;
  }

  function deduplicateEntries(entries) {
    var groups = Object.create(null);
    var order = [];

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var request = entry && entry.request ? entry.request : {};
      var key = endpointKey(request.method, request.url);

      if (!(key in groups)) {
        groups[key] = {
          endpointKey: key,
          normalizedUrl: normalizeUrl(request.url),
          method: typeof request.method === "string" ? request.method.toUpperCase() : "GET",
          entries: [],
        };
        order.push(key);
      }

      groups[key].entries.push(entry);
    }

    var result = [];
    for (var j = 0; j < order.length; j++) {
      result.push(groups[order[j]]);
    }

    return result;
  }

  globalScope.GladiumUrlNormalizer = {
    isDynamicSegment: isDynamicSegment,
    normalizePath: normalizePath,
    normalizeQueryKeys: normalizeQueryKeys,
    normalizeUrl: normalizeUrl,
    endpointKey: endpointKey,
    deduplicateEntries: deduplicateEntries,
  };
})(window);
