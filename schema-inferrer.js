(function initSchemaInferrer(globalScope) {
  if (globalScope.GladiumSchemaInferrer) {
    return;
  }

  var AUTH_HEADER_NAMES = [
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "api-key",
    "x-auth-token",
    "x-access-token",
  ];

  var AUTH_HEADER_PREFIXES = ["x-auth-", "x-api-"];

  var BEARER_RE = /^bearer\s+/i;

  function isAuthHeaderName(name) {
    var lower = typeof name === "string" ? name.toLowerCase() : "";
    if (lower.length === 0) {
      return false;
    }

    for (var i = 0; i < AUTH_HEADER_NAMES.length; i++) {
      if (lower === AUTH_HEADER_NAMES[i]) {
        return true;
      }
    }

    for (var j = 0; j < AUTH_HEADER_PREFIXES.length; j++) {
      if (lower.indexOf(AUTH_HEADER_PREFIXES[j]) === 0) {
        return true;
      }
    }

    return false;
  }

  function hasBearerToken(value) {
    return typeof value === "string" && BEARER_RE.test(value);
  }

  function classifyHeaderAuth(name, value) {
    if (isAuthHeaderName(name)) {
      return true;
    }

    if (hasBearerToken(value)) {
      return true;
    }

    return false;
  }

  function inferHeaderValueType(value) {
    if (typeof value !== "string") {
      return "unknown";
    }

    if (value.length === 0) {
      return "empty";
    }

    if (/^\d+$/.test(value)) {
      return "integer";
    }

    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) && value !== "") {
      return "number";
    }

    if (value === "true" || value === "false") {
      return "boolean";
    }

    return "string";
  }

  function inferHeadersSchema(headers) {
    if (!Array.isArray(headers) || headers.length === 0) {
      return { fields: [] };
    }

    var fields = [];
    for (var i = 0; i < headers.length; i++) {
      var header = headers[i];
      if (!header || typeof header.name !== "string") {
        continue;
      }

      var name = header.name;
      var value = header.value !== undefined ? String(header.value) : "";

      fields.push({
        name: name,
        valueType: inferHeaderValueType(value),
        isAuth: classifyHeaderAuth(name, value),
      });
    }

    return { fields: fields };
  }

  function inferType(value) {
    if (value === null) {
      return "null";
    }

    if (Array.isArray(value)) {
      return "array";
    }

    return typeof value;
  }

  function inferJsonSchema(value) {
    var type = inferType(value);

    if (type === "object") {
      return inferObjectSchema(value);
    }

    if (type === "array") {
      return inferArraySchema(value);
    }

    return { type: type };
  }

  function inferObjectSchema(obj) {
    var keys = Object.keys(obj);
    var fields = {};

    for (var i = 0; i < keys.length; i++) {
      fields[keys[i]] = inferJsonSchema(obj[keys[i]]);
    }

    return {
      type: "object",
      fields: fields,
    };
  }

  function inferArraySchema(arr) {
    if (arr.length === 0) {
      return { type: "array", items: null };
    }

    var itemSchema = inferJsonSchema(arr[0]);

    for (var i = 1; i < arr.length; i++) {
      itemSchema = unifySchemas(itemSchema, inferJsonSchema(arr[i]));
    }

    return {
      type: "array",
      items: itemSchema,
    };
  }

  function unifySchemas(a, b) {
    if (a.type !== b.type) {
      return { type: "mixed", variants: collectTypes(a, b) };
    }

    if (a.type === "object" && b.type === "object") {
      return unifyObjectSchemas(a, b);
    }

    if (a.type === "array" && b.type === "array") {
      if (a.items === null) {
        return { type: "array", items: b.items };
      }
      if (b.items === null) {
        return { type: "array", items: a.items };
      }
      return { type: "array", items: unifySchemas(a.items, b.items) };
    }

    return a;
  }

  function collectTypes(a, b) {
    var types = [];
    if (a.type === "mixed" && Array.isArray(a.variants)) {
      types = types.concat(a.variants);
    } else {
      types.push(a.type);
    }
    if (b.type === "mixed" && Array.isArray(b.variants)) {
      types = types.concat(b.variants);
    } else {
      types.push(b.type);
    }

    var seen = {};
    var unique = [];
    for (var i = 0; i < types.length; i++) {
      if (!seen[types[i]]) {
        seen[types[i]] = true;
        unique.push(types[i]);
      }
    }
    return unique;
  }

  function unifyObjectSchemas(a, b) {
    var merged = {};
    var aFields = a.fields || {};
    var bFields = b.fields || {};
    var aKeys = Object.keys(aFields);
    var bKeys = Object.keys(bFields);

    for (var i = 0; i < aKeys.length; i++) {
      var key = aKeys[i];
      if (bFields[key]) {
        merged[key] = unifySchemas(aFields[key], bFields[key]);
      } else {
        merged[key] = markOptional(aFields[key]);
      }
    }

    for (var j = 0; j < bKeys.length; j++) {
      var bKey = bKeys[j];
      if (!aFields[bKey]) {
        merged[bKey] = markOptional(bFields[bKey]);
      }
    }

    return { type: "object", fields: merged };
  }

  function markOptional(schema) {
    var copy = {};
    var keys = Object.keys(schema);
    for (var i = 0; i < keys.length; i++) {
      copy[keys[i]] = schema[keys[i]];
    }
    copy.optional = true;
    return copy;
  }

  function parseFormUrlEncoded(body) {
    if (typeof body !== "string" || body.length === 0) {
      return null;
    }

    var pairs = body.split("&");
    var result = {};

    for (var i = 0; i < pairs.length; i++) {
      var eq = pairs[i].indexOf("=");
      var key;
      var value;

      if (eq === -1) {
        key = decodeURIComponentSafe(pairs[i]);
        value = "";
      } else {
        key = decodeURIComponentSafe(pairs[i].slice(0, eq));
        value = decodeURIComponentSafe(pairs[i].slice(eq + 1));
      }

      if (key.length > 0) {
        result[key] = coerceFormValue(value);
      }
    }

    return result;
  }

  function decodeURIComponentSafe(str) {
    try {
      return decodeURIComponent(str.replace(/\+/g, " "));
    } catch (e) {
      return str;
    }
  }

  function coerceFormValue(value) {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    if (value === "null") {
      return null;
    }
    if (/^-?\d+$/.test(value) && value.length < 16) {
      var n = Number(value);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    if (/^-?\d+\.\d+$/.test(value) && value.length < 20) {
      var f = Number(value);
      if (Number.isFinite(f)) {
        return f;
      }
    }
    return value;
  }

  function isJsonContentType(contentType) {
    if (typeof contentType !== "string") {
      return false;
    }
    var lower = contentType.toLowerCase();
    return lower.indexOf("json") !== -1 || lower.indexOf("graphql") !== -1;
  }

  function isFormContentType(contentType) {
    if (typeof contentType !== "string") {
      return false;
    }
    return contentType.toLowerCase().indexOf("x-www-form-urlencoded") !== -1;
  }

  function detectBodyContentType(body, contentType) {
    if (isJsonContentType(contentType)) {
      return "json";
    }
    if (isFormContentType(contentType)) {
      return "form";
    }

    if (typeof body === "string" && body.length > 0) {
      var trimmed = body.trimStart();
      if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
        return "json";
      }
      if (trimmed.indexOf("=") !== -1 && trimmed.indexOf("<") === -1) {
        return "form";
      }
    }

    return "unknown";
  }

  function inferBodySchema(body, contentType) {
    if (typeof body !== "string" || body.trim().length === 0) {
      return null;
    }

    var detectedType = detectBodyContentType(body, contentType);

    if (detectedType === "json") {
      try {
        var parsed = JSON.parse(body);
        return {
          contentType: "json",
          schema: inferJsonSchema(parsed),
        };
      } catch (e) {
        return { contentType: "json", parseError: e.message, schema: null };
      }
    }

    if (detectedType === "form") {
      var formData = parseFormUrlEncoded(body);
      if (formData !== null && Object.keys(formData).length > 0) {
        return {
          contentType: "form",
          schema: inferJsonSchema(formData),
        };
      }
      return null;
    }

    return { contentType: "opaque", schema: null };
  }

  function getContentTypeFromHeaders(headers) {
    if (!Array.isArray(headers)) {
      return null;
    }

    for (var i = 0; i < headers.length; i++) {
      var header = headers[i];
      if (
        header &&
        typeof header.name === "string" &&
        header.name.toLowerCase() === "content-type"
      ) {
        return typeof header.value === "string" ? header.value : null;
      }
    }

    return null;
  }

  function inferSchema(entry) {
    if (!entry) {
      return null;
    }

    var request = entry.request || {};
    var response = entry.response || {};

    var reqContentType =
      getContentTypeFromHeaders(request.headers) || response.contentType || null;
    var resContentType =
      getContentTypeFromHeaders(response.headers) || response.contentType || null;

    return {
      request: {
        headers: inferHeadersSchema(request.headers),
        body: inferBodySchema(request.body, reqContentType),
      },
      response: {
        headers: inferHeadersSchema(response.headers),
        body: inferBodySchema(response.body, resContentType),
      },
    };
  }

  globalScope.GladiumSchemaInferrer = {
    inferSchema: inferSchema,
    inferHeadersSchema: inferHeadersSchema,
    inferBodySchema: inferBodySchema,
    inferJsonSchema: inferJsonSchema,
    isAuthHeaderName: isAuthHeaderName,
    classifyHeaderAuth: classifyHeaderAuth,
    unifySchemas: unifySchemas,
  };
})(window);
