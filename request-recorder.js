(function initRequestRecorder(globalScope) {
  if (globalScope.GladiumRequestRecorder) {
    globalScope.GladiumRequestRecorder.start();
    return;
  }

  const EMPTY_ARRAY = Object.freeze([]);
  const URL_PATTERNS = ["/api/", "/graphql/", "/v1/"];
  const AUTH_HEADER_NAMES = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "x-api-key",
    "api-key",
    "x-auth-token",
    "x-access-token",
  ]);
  const SCORE_WEIGHTS = Object.freeze({
    contentTypeJsonOrGraphql: 40,
    methodWrite: 25,
    methodGet: 5,
    urlPattern: 10,
    requestBody: 15,
    authHeader: 15,
  });

  const state = {
    entries: [],
    isListening: false,
    nextId: 1,
  };

  function toSafeArray(value) {
    return Array.isArray(value) ? value : EMPTY_ARRAY;
  }

  function toHeaderMap(headers) {
    const map = {};
    for (const header of toSafeArray(headers)) {
      if (!header || typeof header.name !== "string") {
        continue;
      }

      const name = header.name.toLowerCase();
      map[name] = String(header.value || "");
    }
    return map;
  }

  function getRequestContentType(entry) {
    const request = entry && entry.request ? entry.request : {};
    const headers = toHeaderMap(request.headers);
    const headerContentType = headers["content-type"];
    const mimeType =
      request.postData && typeof request.postData.mimeType === "string"
        ? request.postData.mimeType
        : "";

    return (headerContentType || mimeType || "").toLowerCase();
  }

  function getResponseContentType(entry) {
    const response = entry && entry.response ? entry.response : {};
    const headers = toHeaderMap(response.headers);
    const headerContentType = headers["content-type"];
    const mimeType =
      response.content && typeof response.content.mimeType === "string"
        ? response.content.mimeType
        : "";

    return (headerContentType || mimeType || "").toLowerCase();
  }

  function hasRequestBody(entry) {
    const postData = entry && entry.request ? entry.request.postData : null;
    if (!postData) {
      return false;
    }

    if (typeof postData.text === "string" && postData.text.trim().length > 0) {
      return true;
    }

    return Array.isArray(postData.params) && postData.params.length > 0;
  }

  function hasAuthHeaders(entry) {
    const headers = toHeaderMap(entry && entry.request ? entry.request.headers : null);
    for (const name of Object.keys(headers)) {
      if (
        AUTH_HEADER_NAMES.has(name) ||
        name.startsWith("x-auth-") ||
        name.startsWith("x-api-")
      ) {
        return true;
      }
    }
    return false;
  }

  function getMatchedUrlPatterns(url) {
    if (typeof url !== "string" || url.length === 0) {
      return EMPTY_ARRAY;
    }

    const normalizedUrl = url.toLowerCase();
    return URL_PATTERNS.filter((pattern) => normalizedUrl.includes(pattern));
  }

  function scoreRequest(entry) {
    let total = 0;
    const reasons = [];

    const requestContentType = getRequestContentType(entry);
    const responseContentType = getResponseContentType(entry);
    const contentType = responseContentType || requestContentType;

    if (contentType.includes("json") || contentType.includes("graphql")) {
      total += SCORE_WEIGHTS.contentTypeJsonOrGraphql;
      reasons.push({
        rule: "content-type",
        points: SCORE_WEIGHTS.contentTypeJsonOrGraphql,
        detail: contentType,
      });
    }

    const method =
      entry && entry.request && typeof entry.request.method === "string"
        ? entry.request.method.toUpperCase()
        : "";
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      total += SCORE_WEIGHTS.methodWrite;
      reasons.push({
        rule: "method",
        points: SCORE_WEIGHTS.methodWrite,
        detail: method,
      });
    } else if (method === "GET") {
      total += SCORE_WEIGHTS.methodGet;
      reasons.push({
        rule: "method",
        points: SCORE_WEIGHTS.methodGet,
        detail: method,
      });
    }

    const url = entry && entry.request ? entry.request.url : "";
    const matchedPatterns = getMatchedUrlPatterns(url);
    if (matchedPatterns.length > 0) {
      const urlPoints = matchedPatterns.length * SCORE_WEIGHTS.urlPattern;
      total += urlPoints;
      reasons.push({
        rule: "url-pattern",
        points: urlPoints,
        detail: matchedPatterns.join(", "),
      });
    }

    if (hasRequestBody(entry)) {
      total += SCORE_WEIGHTS.requestBody;
      reasons.push({
        rule: "request-body",
        points: SCORE_WEIGHTS.requestBody,
      });
    }

    if (hasAuthHeaders(entry)) {
      total += SCORE_WEIGHTS.authHeader;
      reasons.push({
        rule: "auth-header",
        points: SCORE_WEIGHTS.authHeader,
      });
    }

    return {
      total,
      reasons,
      normalized: Math.min(100, total),
    };
  }

  function getContent(entry) {
    return new Promise((resolve) => {
      if (!entry || typeof entry.getContent !== "function") {
        resolve({ body: null, encoding: null, error: "getContent unavailable" });
        return;
      }

      try {
        entry.getContent((body, encoding) => {
          resolve({
            body: typeof body === "string" ? body : null,
            encoding: encoding || null,
            error: null,
          });
        });
      } catch (error) {
        resolve({
          body: null,
          encoding: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  function buildRecordedEntry(entry, contentResult) {
    const request = entry && entry.request ? entry.request : {};
    const response = entry && entry.response ? entry.response : {};
    const score = scoreRequest(entry);

    return {
      id: state.nextId++,
      capturedAt: new Date().toISOString(),
      score,
      request: {
        method: request.method || null,
        url: request.url || null,
        headers: toSafeArray(request.headers),
        body: request.postData && typeof request.postData.text === "string"
          ? request.postData.text
          : null,
      },
      response: {
        status: typeof response.status === "number" ? response.status : null,
        statusText: response.statusText || null,
        headers: toSafeArray(response.headers),
        contentType: getResponseContentType(entry) || getRequestContentType(entry) || null,
        body: contentResult.body,
        encoding: contentResult.encoding,
        bodyCaptureError: contentResult.error,
      },
      timing: {
        startedDateTime: entry && entry.startedDateTime ? entry.startedDateTime : null,
        durationMs: entry && typeof entry.time === "number" ? entry.time : null,
      },
    };
  }

  async function handleRequestFinished(entry) {
    const contentResult = await getContent(entry);
    state.entries.push(buildRecordedEntry(entry, contentResult));
  }

  function start() {
    if (state.isListening) {
      return;
    }

    if (
      !globalScope.chrome ||
      !chrome.devtools ||
      !chrome.devtools.network ||
      !chrome.devtools.network.onRequestFinished
    ) {
      return;
    }

    chrome.devtools.network.onRequestFinished.addListener(handleRequestFinished);
    state.isListening = true;
  }

  function stop() {
    if (!state.isListening) {
      return;
    }

    chrome.devtools.network.onRequestFinished.removeListener(handleRequestFinished);
    state.isListening = false;
  }

  function clear() {
    state.entries.length = 0;
  }

  function getEntries() {
    return state.entries.slice();
  }

  globalScope.GladiumRequestRecorder = {
    start,
    stop,
    clear,
    getEntries,
  };

  start();
})(window);
