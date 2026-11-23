/* Google One combined 2TB / 20TB / 30TB mappings (iOS App + Web) for Shadowrocket / Surge / Stash. */
"use strict";

(function () {
  var VERSION = "g1-acq-v8.1";
  var SOURCE_PREFIX = "g1.ios.2tb.";
  var SUB_PREFIX = "subs:com.google.android.apps.subscriptions.red:";
  // User-selected 12-month offer ID from the screenshot; store metadata is still unverified.
  var TARGET = "g1.2tb.ai.12months_ip_90p";
  var SKU_MAP = {
    "g1.ios.20tb.m.v2": "g1.20tb.3months_ip_90p.acq",
    "g1.ios.30tb.ai.pro.m": "g1.ai.ultra.3months_ip_90p.acq"
  };
  var WEB_2TB_SOURCES = {
    "g1.2tb.ai": true,
    "g1.2tb.ai.annual": true,
    "g1.play.2tb.ai": true
  };
  var WEB_SKU_MAP = {
    "g1.20tb": "g1.20tb.3months_ip_90p.acq",
    "g1.20tb.v2": "g1.20tb.3months_ip_90p.acq",
    "g1.play.20tb": "g1.20tb.3months_ip_90p.acq",
    "g1.ai.pro": "g1.ai.ultra.3months_ip_90p.acq",
    "g1.30tb": "g1.ai.ultra.3months_ip_90p.acq",
    "g1.play.ai.pro": "g1.ai.ultra.3months_ip_90p.acq"
  };
  var FALLBACK = {
    "g1.20tb.3months_ip_90p.acq": "g1.20tb.3months_ip_75p.acq",
    "g1.ai.ultra.3months_ip_90p.acq": "g1.ai.ultra.3months_ip_75p.acq"
  };
  var OFFER_TOKENS = {
    "g1.2tb.ai.12months_ip_90p": "AYrTWi7W8ZhHHzTZCLOtTLeN/Th2bL1VXWC0iWtQT8+2r4czXLlSZlHvbr8wJVXd7Z0IE//tsVOhqXZPDVTZyer/axAhjZ/A",
    "g1.20tb.3months_ip_90p.acq": "AYrTWi6m390S5L8/v/68ytX7FGefqs730Fb8RMphQ9nHXjRga2FTIto3+rL6WvPp4kNgYB2aQTdKr8S4mI6ehGhrLWAW4tti",
    "g1.20tb.3months_ip_75p.acq": "AYrTWi6m390S5L8/v/68ytX7FGefqs730Fb8RMphQ9nHXjRga2FTIto3+rL6WvPp4kNgYB2aQTdKr8S4mI6ehGhrLWAW4tti",
    "g1.ai.ultra.3months_ip_90p.acq": "AYrTWi6m390S5L8/v/68ytX7FGefqs730Fb8RMphQ9nHXjRga2FTIto3+rL6WvPp4kNgYB2aQTdKr8S4mI6ehGhrLWAW4tti",
    "g1.ai.ultra.3months_ip_75p.acq": "AYrTWi6m390S5L8/v/68ytX7FGefqs730Fb8RMphQ9nHXjRga2FTIto3+rL6WvPp4kNgYB2aQTdKr8S4mI6ehGhrLWAW4tti"
  };
  var SAFE_PATHS = [
    "/", "/ai", "/plans", "/upgrade", "/settings", "/about", "/explore-plan",
    "/offer", "/storage", "/checkout", "/_/…/data/batchexecute", "[其他 one.google.com 路径]"
  ];
  var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var TEST_KEY = "g1.pro.annual.test.v1";
  var SCAN_KEY = "g1.sku.scan.v1";
  var SCAN_LIMIT = 300;
  var RECENT_LIMIT = 10;
  var MAX_EVENT_COUNT = 9007199254740991;
  var url = typeof $request === "object" && $request ? $request.url : "";
  var rewriteWeb = parseRewriteWeb();

  if (typeof $response !== "object" || $response === null) {
    handleHttpRequest();
    return;
  }

  if (typeof url !== "string" || !/^https:\/\/one\.google\.com\//.test(url) ||
      /^https:\/\/one\.google\.com\/g1-sku-report\/?(?:\?|$)/.test(url)) {
    $done({});
    return;
  }

  var body = $response.body;
  try {
    collectOriginalSkus(body);
  } catch (error) {
    console.log("[g1-acq] SKU collection unavailable");
  }

  if (!isRewriteUrl(url, rewriteWeb)) {
    $done({});
    return;
  }

  var mappings = Object.create(null);
  var hits = 0;
  var annualHits = 0;
  var out = body;

  if (typeof body === "string") {
    // Preserve v6's 20TB/30TB fallback rule using the original response.
    // These are observed strings, not a verified store catalog.
    var observed = body.match(/g1\.[a-z0-9._]{2,60}acq/g) || [];
    var replaceTokens = function (text) {
      // Match complete tokens before selecting 2TB or the configured iOS/Web source IDs.
      return text.replace(
        /(^|[^A-Za-z0-9._@%-])(g1\.[A-Za-z0-9._-]+)(?=$|[^A-Za-z0-9._-])/g,
        function (match, before, id) {
          var isIos2tb = id.indexOf(SOURCE_PREFIX) === 0 && id.length > SOURCE_PREFIX.length;
          var isWeb2tb = rewriteWeb && Object.prototype.hasOwnProperty.call(WEB_2TB_SOURCES, id);
          var isAnnual = isIos2tb || isWeb2tb;
          var to;
          var fallback = false;
          var mappedTarget = Object.prototype.hasOwnProperty.call(SKU_MAP, id) ? SKU_MAP[id] :
            (rewriteWeb && Object.prototype.hasOwnProperty.call(WEB_SKU_MAP, id) ? WEB_SKU_MAP[id] : "");
          if (isAnnual) {
            to = TARGET;
          } else if (mappedTarget) {
            to = mappedTarget;
            if (observed.indexOf(to) === -1 && FALLBACK[to] && observed.indexOf(FALLBACK[to]) !== -1) {
              to = FALLBACK[to];
              fallback = true;
            }
          } else {
            return match;
          }
          if (!mappings[id]) mappings[id] = { id: id, to: to, count: 0, fallback: fallback };
          mappings[id].count += 1;
          hits += 1;
          if (isAnnual) annualHits += 1;
          return before + to;
        }
      );
    };
    out = rewriteBatchExecute(body, replaceTokens);
  }

  var sources = Object.keys(mappings).sort().map(function (id) {
    return mappings[id];
  });
  var record = {
    schemaVersion: 1,
    version: VERSION,
    updatedAt: new Date().toISOString(),
    sourcePrefix: SOURCE_PREFIX,
    target: TARGET,
    targetOrigin: "user-specified",
    hitCount: hits,
    // Legacy field name: counts 2TB/Pro rewrites, not the billing interval.
    annualHitCount: annualHits,
    matchedFrom: sources,
    status: typeof body !== "string" ? "non-text" : hits ? "rewritten" : "no-match"
  };

  try {
    if (typeof $persistentStore !== "undefined" &&
        typeof $persistentStore.write === "function") {
      if (!$persistentStore.write(JSON.stringify(record), TEST_KEY)) {
        console.log("[g1-acq] local record write failed");
      }
    }
  } catch (error) {
    console.log("[g1-acq] local record unavailable");
  }

  console.log("[g1-acq] " + VERSION + " hits=" + hits + " annualHits=" + annualHits);
  sources.forEach(function (source) {
    console.log("[g1-acq] " + source.id + " -> " + source.to + " x" + source.count +
      (source.fallback ? " fallback=75p" : ""));
  });
  $done(hits ? { body: out } : {});

  function collectOriginalSkus(originalBody) {
    var now = new Date().toISOString();
    var saved = {};
    try {
      if (typeof $persistentStore !== "undefined" && typeof $persistentStore.read === "function") {
        saved = JSON.parse($persistentStore.read(SCAN_KEY) || "{}");
      }
    } catch (error) {
      saved = {};
    }
    if (!saved || saved.schemaVersion !== 1) saved = {};

    var byId = Object.create(null);
    var ids = [];
    var validId = /^(?:g1\.|com\.google\.one\.)[A-Za-z0-9._-]{1,160}$/;
    var oldRows = Array.isArray(saved.skus) ? saved.skus : [];
    oldRows.slice(0, SCAN_LIMIT).forEach(function (row) {
      if (!row || typeof row.id !== "string" || !validId.test(row.id) || byId[row.id]) return;
      var count = Number(row.count);
      byId[row.id] = {
        id: row.id,
        count: isFinite(count) && count > 0 ? Math.floor(count) : 0,
        lastSeen: typeof row.lastSeen === "string" ? row.lastSeen.slice(0, 32) : ""
      };
      ids.push(row.id);
    });

    var isText = typeof originalBody === "string";
    var found = Object.create(null);
    var hitCount = 0;
    var addedCount = 0;
    var omittedCount = 0;
    var truncated = saved.truncated === true;
    if (isText) {
      // Decode escaped dots on a discovery copy before rewriting the original body.
      var text = originalBody.replace(/\\u002e|\\x2e|&#0*46;|&#x0*2e;|&period;/gi, ".");
      var token = /(^|[^A-Za-z0-9._@%-])((?:g1\.|com\.google\.one\.)[A-Za-z0-9._-]+)(?=$|[^A-Za-z0-9._-])/g;
      var match;
      while ((match = token.exec(text)) !== null) {
        var id = match[2];
        if (!validId.test(id)) continue;
        found[id] = (found[id] || 0) + 1;
        hitCount += 1;
        if (!byId[id]) {
          if (ids.length >= SCAN_LIMIT) {
            truncated = true;
            if (found[id] === 1) omittedCount += 1;
            continue;
          }
          byId[id] = { id: id, count: 0, lastSeen: now };
          ids.push(id);
          addedCount += 1;
        }
        byId[id].count += 1;
        byId[id].lastSeen = now;
      }
    }

    var candidateCount = Object.keys(found).length;
    var bodyType = isText ? "text" : "non-text";
    var status = responseStatus(bodyType, candidateCount, addedCount, omittedCount);
    var recentResponses = [];
    var oldResponses = Array.isArray(saved.recentResponses) ? saved.recentResponses : [];
    oldResponses.slice(-RECENT_LIMIT).forEach(function (row) {
      var event = priorResponse(row);
      if (event) recentResponses.push(event);
    });
    // Preserve arrival order even if the device clock moves backward.
    recentResponses.push({
      at: now,
      path: safeRoute(url),
      bodyType: bodyType,
      status: status,
      candidateCount: candidateCount,
      addedCount: addedCount,
      omittedCount: omittedCount
    });

    function priorCount(value) {
      var number = Number(value);
      return isFinite(number) && number > 0 ? Math.floor(number) : 0;
    }
    var state = {
      schemaVersion: 1,
      version: VERSION,
      updatedAt: now,
      scannedResponses: priorCount(saved.scannedResponses) + (isText ? 1 : 0),
      matchedResponses: priorCount(saved.matchedResponses) + (hitCount > 0 ? 1 : 0),
      nonTextResponses: priorCount(saved.nonTextResponses) + (isText ? 0 : 1),
      recentResponses: recentResponses.slice(-RECENT_LIMIT),
      limit: SCAN_LIMIT,
      truncated: truncated,
      skus: ids.sort().map(function (id) { return byId[id]; })
    };
    var stored = false;
    try {
      if (typeof $persistentStore !== "undefined" && typeof $persistentStore.write === "function") {
        stored = $persistentStore.write(JSON.stringify(state), SCAN_KEY);
      }
    } catch (error) {
      stored = false;
    }

    console.log("[g1-acq] " + VERSION + " status=" + status + " addedCount=" + addedCount +
      " candidates=" + candidateCount + " omittedCount=" + omittedCount +
      " occurrences=" + hitCount + " saved=" + (stored ? "yes" : "no"));
    Object.keys(found).sort().slice(0, SCAN_LIMIT).forEach(function (id) {
      console.log("[g1-acq] " + id + " x" + found[id]);
    });
  }

  function handleHttpRequest() {
    if (!rewriteWeb || typeof url !== "string") {
      $done({});
      return;
    }
    if (/^https:\/\/one\.google\.com\/(?:u\/\d+\/)?_\/[^?#]+\/data\/batchexecute/.test(url)) {
      var reqBody = typeof $request === "object" && $request ? $request.body : undefined;
      if (typeof reqBody !== "string" || reqBody.indexOf("f.req=") === -1 || reqBody.indexOf("Ngbm") === -1) {
        $done({});
        return;
      }
      try {
        var reqParts = reqBody.split("&");
        var bodyChanged = false;
        for (var i = 0; i < reqParts.length; i++) {
          if (reqParts[i].indexOf("f.req=") !== 0) continue;
          var rawFreq = decodeURIComponent(reqParts[i].slice(6).replace(/\+/g, " "));
          var outer = JSON.parse(rawFreq);
          if (!Array.isArray(outer)) continue;
          var freqChanged = false;
          for (var g = 0; g < outer.length; g++) {
            var group = outer[g];
            if (!Array.isArray(group)) continue;
            for (var c = 0; c < group.length; c++) {
              var call = group[c];
              if (Array.isArray(call) && call[0] === "Ngbm" && typeof call[1] === "string") {
                var payload = JSON.parse(call[1]);
                if (Array.isArray(payload)) {
                  var p0 = patchNgbmNode(payload[0]);
                  var p1 = patchNgbmNode(payload[1]);
                  if (p0 || p1) {
                    call[1] = JSON.stringify(payload);
                    freqChanged = true;
                  }
                }
              }
            }
          }
          if (freqChanged) {
            reqParts[i] = "f.req=" + encodeURIComponent(JSON.stringify(outer));
            bodyChanged = true;
          }
        }
        if (bodyChanged) {
          console.log("[g1-acq] " + VERSION + " Ngbm checkout patched");
          $done({ body: reqParts.join("&") });
          return;
        }
      } catch (error) {
        console.log("[g1-acq] Ngbm patch skipped");
      }
      $done({});
      return;
    }

    if (/^https:\/\/tokenized\.play\.google\.com\/eacquire\/multiline\?/.test(url)) {
      try {
        var qIdx = url.indexOf("?");
        var baseUrl = url.slice(0, qIdx);
        var queryParts = url.slice(qIdx + 1).split("&");
        var urlChanged = false;
        for (var k = 0; k < queryParts.length; k++) {
          if (queryParts[k].indexOf("ear=") !== 0) continue;
          var rawEar = decodeURIComponent(queryParts[k].slice(4).replace(/\+/g, " "));
          var ear = JSON.parse(rawEar);
          if (!Array.isArray(ear)) continue;
          var earChanged = false;
          if (ear.length > 13 && Array.isArray(ear[13]) && Array.isArray(ear[13][0])) {
            if (patchCheckoutItems(ear[13][0])) earChanged = true;
          }
          if (ear.length > 4 && Array.isArray(ear[4]) && typeof ear[4][0] === "string") {
            try {
              var inner4 = JSON.parse(b64Decode(ear[4][0]));
              if (Array.isArray(inner4) && inner4.length > 8 &&
                  Array.isArray(inner4[8]) && Array.isArray(inner4[8][0]) &&
                  patchCheckoutItems(inner4[8][0])) {
                ear[4][0] = b64Encode(JSON.stringify(inner4));
                earChanged = true;
              }
            } catch (innerError) {}
          }
          if (earChanged) {
            if (Array.isArray(ear[8]) && Array.isArray(ear[8][5]) && ear[8][5].length > 0) {
              ear[8][1] = 5;
            }
            while (ear.length < 25) ear.push(null);
            ear[24] = null;
            queryParts[k] = "ear=" + encodeURIComponent(JSON.stringify(ear));
            urlChanged = true;
          }
        }
        if (urlChanged) {
          console.log("[g1-acq] " + VERSION + " multiline checkout patched");
          $done({ url: baseUrl + "?" + queryParts.join("&") });
          return;
        }
      } catch (error) {
        console.log("[g1-acq] multiline patch skipped");
      }
      $done({});
      return;
    }

    $done({});
  }

  function resolveCheckoutTarget(sku) {
    if (Object.prototype.hasOwnProperty.call(OFFER_TOKENS, sku)) {
      return { sku: sku, token: OFFER_TOKENS[sku] };
    }
    var mapped = "";
    if (sku.indexOf(SOURCE_PREFIX) === 0 && sku.length > SOURCE_PREFIX.length) {
      mapped = TARGET;
    } else if (Object.prototype.hasOwnProperty.call(WEB_2TB_SOURCES, sku)) {
      mapped = TARGET;
    } else if (Object.prototype.hasOwnProperty.call(SKU_MAP, sku)) {
      mapped = SKU_MAP[sku];
    } else if (Object.prototype.hasOwnProperty.call(WEB_SKU_MAP, sku)) {
      mapped = WEB_SKU_MAP[sku];
    }
    if (!mapped || !Object.prototype.hasOwnProperty.call(OFFER_TOKENS, mapped)) return null;
    return { sku: mapped, token: OFFER_TOKENS[mapped] };
  }

  function patchCheckoutItems(items) {
    if (!Array.isArray(items)) return false;
    var changed = false;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!Array.isArray(item) || !Array.isArray(item[0]) || typeof item[0][0] !== "string") continue;
      if (item[0][0].indexOf(SUB_PREFIX) !== 0) continue;
      var sku = item[0][0].slice(SUB_PREFIX.length);
      var resolved = resolveCheckoutTarget(sku);
      if (!resolved) continue;
      item[0][0] = SUB_PREFIX + resolved.sku;
      while (item.length < 6) item.push(null);
      item[4] = 1;
      item[5] = [resolved.token];
      changed = true;
    }
    return changed;
  }

  function patchNgbmNode(node) {
    if (!Array.isArray(node)) return false;
    var changed = false;
    if (node.length > 12 && Array.isArray(node[12]) && patchCheckoutItems(node[12])) {
      if (Array.isArray(node[7]) && Array.isArray(node[7][5]) && node[7][5].length > 0) {
        node[7][1] = 5;
      }
      changed = true;
    }
    if (node.length > 10 && Array.isArray(node[10]) && Array.isArray(node[10][0]) &&
        patchCheckoutItems(node[10][0])) {
      changed = true;
    }
    if (node.length > 2 && Array.isArray(node[2]) && Array.isArray(node[2][2]) &&
        Array.isArray(node[2][2][8]) && Array.isArray(node[2][2][8][0]) &&
        patchCheckoutItems(node[2][2][8][0])) {
      changed = true;
    }
    return changed;
  }

  function b64Decode(input) {
    var clean = String(input).replace(/[\s=]/g, "").replace(/-/g, "+").replace(/_/g, "/");
    var bytes = [];
    for (var i = 0; i < clean.length; i += 4) {
      var c1 = B64_CHARS.indexOf(clean.charAt(i));
      var c2 = B64_CHARS.indexOf(clean.charAt(i + 1));
      var c3 = i + 2 < clean.length ? B64_CHARS.indexOf(clean.charAt(i + 2)) : -1;
      var c4 = i + 3 < clean.length ? B64_CHARS.indexOf(clean.charAt(i + 3)) : -1;
      if (c1 < 0 || c2 < 0) return "";
      bytes.push((c1 << 2) | (c2 >> 4));
      if (c3 >= 0) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
      if (c4 >= 0) bytes.push(((c3 & 3) << 6) | c4);
    }
    var hex = "";
    for (var j = 0; j < bytes.length; j++) {
      var b = bytes[j] & 255;
      hex += "%" + (b < 16 ? "0" : "") + b.toString(16);
    }
    try {
      return decodeURIComponent(hex);
    } catch (error) {
      var raw = "";
      for (var k = 0; k < bytes.length; k++) raw += String.fromCharCode(bytes[k]);
      return raw;
    }
  }

  function b64Encode(input) {
    var encoded = encodeURIComponent(String(input));
    var bytes = [];
    for (var i = 0; i < encoded.length; i++) {
      var ch = encoded.charAt(i);
      if (ch === "%") {
        bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(ch.charCodeAt(0));
      }
    }
    var outStr = "";
    for (var j = 0; j < bytes.length; j += 3) {
      var b1 = bytes[j] & 255;
      var hasB2 = j + 1 < bytes.length;
      var hasB3 = j + 2 < bytes.length;
      var b2 = hasB2 ? bytes[j + 1] & 255 : 0;
      var b3 = hasB3 ? bytes[j + 2] & 255 : 0;
      outStr += B64_CHARS.charAt(b1 >> 2);
      outStr += B64_CHARS.charAt(((b1 & 3) << 4) | (b2 >> 4));
      outStr += hasB2 ? B64_CHARS.charAt(((b2 & 15) << 2) | (b3 >> 6)) : "=";
      outStr += hasB3 ? B64_CHARS.charAt(b3 & 63) : "=";
    }
    return outStr;
  }

  function rewriteBatchExecute(text, replaceFn) {
    if (!/^\)\]\}'\r?\n/.test(text)) return replaceFn(text);
    var segs = [];
    var re = /([^\r\n]*)(\r?\n|$)/g;
    var match;
    while ((match = re.exec(text)) !== null) {
      if (match.index === text.length && match[0] === "") break;
      segs.push({ content: match[1], sep: match[2] });
      if (re.lastIndex === match.index) re.lastIndex += 1;
    }
    var result = [];
    var framed = 0;
    var i = 0;
    while (i < segs.length) {
      if (i > 0 && /^\d+$/.test(segs[i].content) && i + 1 < segs.length &&
          segs[i + 1].content.charAt(0) === "[") {
        var origLen = parseInt(segs[i].content, 10);
        var j = i + 1;
        var payloadParts = [segs[j].content];
        while (j + 1 < segs.length) {
          var nextContent = segs[j + 1].content;
          if (!nextContent || (/^\d+$/.test(nextContent) && j + 2 < segs.length &&
              segs[j + 2].content.charAt(0) === "[")) {
            break;
          }
          payloadParts.push(segs[j].sep, nextContent);
          j += 1;
        }
        var origPayload = payloadParts.join("");
        var newPayload = replaceFn(origPayload);
        var delta = newPayload.length - origPayload.length;
        result.push(String(Math.max(0, origLen + delta)) + segs[i].sep);
        result.push(newPayload + segs[j].sep);
        framed += 1;
        i = j + 1;
      } else {
        result.push(segs[i].content + segs[i].sep);
        i += 1;
      }
    }
    return framed > 0 ? result.join("") : replaceFn(text);
  }

  function parseRewriteWeb() {
    if (typeof $argument === "boolean") return $argument;
    if (typeof $argument === "object" && $argument !== null &&
        Object.prototype.hasOwnProperty.call($argument, "rewriteWeb")) {
      return !/^(?:false|0|off|no)$/i.test(String($argument.rewriteWeb).trim());
    }
    if (typeof $argument !== "string") return true;
    var trimmed = $argument.trim();
    if (!trimmed || trimmed.indexOf("{{{") !== -1) return true;
    if (/^(?:false|0|off|no)$/i.test(trimmed)) return false;
    var match = trimmed.match(/(?:^|[&,;\s])rewriteWeb\s*=\s*([^&,;\s]+)/i);
    if (!match) return true;
    var val = match[1].replace(/^["']|["']$/g, "").trim();
    if (!val || val.indexOf("{{{") !== -1) return true;
    return !/^(?:false|0|off|no)$/i.test(val);
  }

  function normalizePath(requestUrl) {
    var path = requestUrl.replace(/^https:\/\/one\.google\.com/, "").split(/[?#]/)[0];
    path = path.replace(/^\/u\/\d+(?=\/|$)/, "");
    return path.replace(/\/+$/, "") || "/";
  }

  function isRewriteUrl(requestUrl, allowWeb) {
    if (/^https:\/\/one\.google\.com\/ai\?/.test(requestUrl)) return true;
    if (!allowWeb) return false;
    var path = normalizePath(requestUrl);
    if (path === "/") return true;
    if (/^\/(?:ai|ai-plans|plans|upgrade|settings|about|explore-plan|offer|storage|buy|checkout|subscribe|acquire)(?:\/|$)/.test(path)) return true;
    return /^\/_\/[^?#]+\/data\/batchexecute$/.test(path);
  }

  function safeRoute(requestUrl) {
    var path = normalizePath(requestUrl);
    if (path === "/") return "/";
    if (/^\/(?:ai|ai-plans)(?:\/|$)/.test(path)) return "/ai";
    if (/^\/(?:buy|checkout|subscribe|acquire)(?:\/|$)/.test(path)) return "/checkout";
    var prefixMatch = path.match(/^\/(plans|upgrade|settings|about|explore-plan|offer|storage)(?:\/|$)/);
    if (prefixMatch) return "/" + prefixMatch[1];
    if (/^\/_\/[^?#]+\/data\/batchexecute$/.test(path)) return "/_/…/data/batchexecute";
    return "[其他 one.google.com 路径]";
  }

  function responseStatus(bodyType, candidateCount, addedCount, omittedCount) {
    if (bodyType === "non-text") return "non-text";
    if (addedCount > 0) return "new-skus";
    if (omittedCount > 0) return "limit-reached";
    return candidateCount > 0 ? "known-skus" : "no-skus";
  }

  function priorResponse(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    if (typeof row.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.at) ||
        !isFinite(Date.parse(row.at)) || new Date(row.at).toISOString() !== row.at) return null;
    if (SAFE_PATHS.indexOf(row.path) === -1) return null;
    if (row.bodyType !== "text" && row.bodyType !== "non-text") return null;

    function counter(value, maximum) {
      if (typeof value !== "number" || !isFinite(value)) return null;
      return Math.max(0, Math.min(maximum, Math.floor(value)));
    }
    var candidateCount = counter(row.candidateCount, MAX_EVENT_COUNT);
    if (candidateCount === null) return null;
    var addedCount = counter(row.addedCount, Math.min(SCAN_LIMIT, candidateCount));
    if (addedCount === null) return null;
    var omittedCount = counter(row.omittedCount, candidateCount - addedCount);
    if (omittedCount === null) return null;
    if (row.bodyType === "non-text" && (candidateCount || addedCount || omittedCount)) return null;
    if (row.status !== responseStatus(row.bodyType, candidateCount, addedCount, omittedCount)) return null;
    return {
      at: row.at,
      path: row.path,
      bodyType: row.bodyType,
      status: row.status,
      candidateCount: candidateCount,
      addedCount: addedCount,
      omittedCount: omittedCount
    };
  }
})();
