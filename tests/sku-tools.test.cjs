"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const TARGET = "g1.2tb.ai.12months_ip_90p";
const LEGACY_TARGET = "g1.2tb.ai.annual";
const SCAN_KEY = "g1.sku.scan.v1";
const TEST_KEY = "g1.pro.annual.test.v1";
const REPORT = "https://one.google.com/g1-sku-report";
// Fixture source IDs test the matching contract; they are not store catalog evidence.
const SOURCE = "g1.ios.2tb.fixture_monthly";
const OTHER_SOURCE = "g1.ios.2tb.fixture_annual";
const TWENTY = "g1.ios.20tb.m.v2";
const THIRTY = "g1.ios.30tb.ai.pro.m";
const TWENTY_TARGET = "g1.20tb.3months_ip_90p.acq";
const THIRTY_TARGET = "g1.ai.ultra.3months_ip_90p.acq";
const TWENTY_FALLBACK = "g1.20tb.3months_ip_75p.acq";
const THIRTY_FALLBACK = "g1.ai.ultra.3months_ip_75p.acq";
const source = Object.fromEntries(
  ["g1-acq.js", "tests/fixtures/g1-acq-v6.js", "g1-sku-scan.js", "g1-sku-report.js"].map(name =>
    [name, fs.readFileSync(path.join(root, name), "utf8")])
);

function run(name, options = {}) {
  const storage = options.storage || new Map();
  const calls = [];
  const logs = [];
  const reads = [];
  const writes = [];
  const req = {
    url: options.url || "https://one.google.com/ai?fixture=1",
    headers: { Cookie: "cookie-secret", Authorization: "auth-secret" }
  };
  if (Object.prototype.hasOwnProperty.call(options, "requestBody")) {
    req.body = options.requestBody;
  }
  const context = {
    $request: req,
    $done: payload => calls.push(JSON.parse(JSON.stringify(payload))),
    console: { log: value => logs.push(String(value)) }
  };
  if (!options.isRequest) {
    context.$response = { body: options.body, headers: { "x-private": "response-secret" } };
  }
  if (Object.prototype.hasOwnProperty.call(options, "argument")) {
    context.$argument = options.argument;
  }
  if (options.storageAvailable !== false) {
    context.$persistentStore = {
      read(key) {
        if (options.storageThrows) throw new Error("fixture storage failure");
        reads.push(key);
        return storage.get(key) || null;
      },
      write(value, key) {
        if (options.storageThrows) throw new Error("fixture storage failure");
        writes.push(key);
        if (options.storageWriteFails) return false;
        storage.set(key, value);
        return true;
      }
    };
  }
  vm.runInNewContext(source[name], context, { timeout: 2000, filename: name });
  assert.equal(calls.length, 1, "$done must be called once");
  return { payload: calls[0], storage, logs, reads, writes };
}

function get(storage, key) {
  return JSON.parse(storage.get(key));
}

test("combined module maps 2TB, 20TB and 30TB while preserving unrelated full tokens", () => {
  const untouched = [
    "g1.ios.12tb.fixture", TWENTY + ".extra", THIRTY + ".extra",
    "g1.ios.2tbx.fixture", "prefix" + SOURCE, "x." + SOURCE,
    "person@" + SOURCE, "g1.2tb", TARGET
  ];
  const values = [SOURCE, OTHER_SOURCE, SOURCE, TWENTY, THIRTY, ...untouched];
  const result = run("g1-acq.js", { body: JSON.stringify(values) });
  assert.deepEqual(JSON.parse(result.payload.body), [TARGET, TARGET, TARGET, TWENTY_TARGET, THIRTY_TARGET, ...untouched]);
  const record = get(result.storage, TEST_KEY);
  assert.equal(record.hitCount, 5);
  assert.equal(record.annualHitCount, 3);
  assert.equal(record.status, "rewritten");
  assert.equal(record.version, "g1-acq-v8.1");
  assert.deepEqual(record.matchedFrom, [
    { id: TWENTY, to: TWENTY_TARGET, count: 1, fallback: false },
    { id: OTHER_SOURCE, to: TARGET, count: 1, fallback: false },
    { id: SOURCE, to: TARGET, count: 2, fallback: false },
    { id: THIRTY, to: THIRTY_TARGET, count: 1, fallback: false }
  ]);
});

test("empty responses or responses with no configured sources pass through", () => {
  for (const body of ["", "g1.ios.100gb.m", "g1.ios.20tb.other", "g1.ios.30tb.other"]) {
    const result = run("g1-acq.js", { body });
    assert.deepEqual(result.payload, {});
    assert.equal(get(result.storage, TEST_KEY).status, "no-match");
  }
  for (const body of [undefined, null, 123, {}]) {
    const result = run("g1-acq.js", { body });
    assert.deepEqual(result.payload, {});
    assert.equal(get(result.storage, TEST_KEY).status, "non-text");
  }
});

test("20TB and 30TB fallback results agree with the original v6 across all offer combinations", () => {
  const offers = [TWENTY_TARGET, THIRTY_TARGET, TWENTY_FALLBACK, THIRTY_FALLBACK];
  for (let mask = 0; mask < 16; mask++) {
    const observed = offers.filter((_, index) => mask & (1 << index));
    const body = JSON.stringify([TWENTY, THIRTY, TWENTY, ...observed]);
    const legacy = run("tests/fixtures/g1-acq-v6.js", { body });
    const combined = run("g1-acq.js", { body });
    assert.equal(combined.payload.body, legacy.payload.body, "offer mask=" + mask);
    const record = get(combined.storage, TEST_KEY);
    assert.equal(record.hitCount, 3);
    assert.equal(record.annualHitCount, 0);
    assert.equal(record.status, "rewritten");
  }
});

test("fallback decisions are independent and the 2TB target stays fixed", () => {
  const body = JSON.stringify([SOURCE, TWENTY, THIRTY, TWENTY_TARGET, TWENTY_FALLBACK, THIRTY_FALLBACK]);
  const result = run("g1-acq.js", { body });
  assert.deepEqual(JSON.parse(result.payload.body).slice(0, 3), [TARGET, TWENTY_TARGET, THIRTY_FALLBACK]);
  const rows = get(result.storage, TEST_KEY).matchedFrom;
  assert.deepEqual(rows.find(row => row.id === SOURCE), { id: SOURCE, to: TARGET, count: 1, fallback: false });
  assert.deepEqual(rows.find(row => row.id === TWENTY), { id: TWENTY, to: TWENTY_TARGET, count: 1, fallback: false });
  assert.deepEqual(rows.find(row => row.id === THIRTY), { id: THIRTY, to: THIRTY_FALLBACK, count: 1, fallback: true });
});

test("single module collects other Google pages without changing the last mapping record", () => {
  for (const url of [
    "https://one.google.com/support/help?token=private-token",
    "https://one.google.com/account/profile"
  ]) {
    const previous = JSON.stringify({ schemaVersion: 1, version: "previous-record", hitCount: 2 });
    const storage = new Map([[TEST_KEY, previous]]);
    const result = run("g1-acq.js", { url, body: SOURCE, storage });
    assert.deepEqual(result.payload, {});
    assert.equal(storage.get(TEST_KEY), previous);
    assert.equal(get(storage, SCAN_KEY).skus[0].id, SOURCE);
  }
  for (const url of [
    "https://one.google.com/ai", "https://one.google.com/ai/other?x=1",
    "https://one.google.com/plans?x=1"
  ]) {
    const previous = JSON.stringify({ schemaVersion: 1, version: "previous-record", hitCount: 2 });
    const storage = new Map([[TEST_KEY, previous]]);
    const result = run("g1-acq.js", { url, body: SOURCE + " g1.2tb.ai", storage, argument: "rewriteWeb=false" });
    assert.deepEqual(result.payload, {});
    assert.equal(storage.get(TEST_KEY), previous);
    assert.deepEqual(get(storage, SCAN_KEY).skus.map(row => row.id), ["g1.2tb.ai", SOURCE]);
  }
  const webDisabledOnAi = run("g1-acq.js", {
    url: "https://one.google.com/ai?x=1",
    body: JSON.stringify([SOURCE, "g1.2tb.ai", "g1.20tb"]),
    argument: "rewriteWeb=false"
  });
  assert.deepEqual(JSON.parse(webDisabledOnAi.payload.body), [TARGET, "g1.2tb.ai", "g1.20tb"]);
  for (const url of [
    "https://one.google.com.evil/ai?x=1", "http://one.google.com/ai?x=1",
    REPORT, REPORT + "?format=json", REPORT + "/", REPORT + "/?format=json"
  ]) {
    const result = run("g1-acq.js", { url, body: SOURCE });
    assert.deepEqual(result.payload, {});
    assert.equal(result.storage.size, 0);
  }
});

test("single module saves original candidates before rewriting without recording generated targets", () => {
  const body = JSON.stringify([SOURCE, SOURCE, TWENTY, THIRTY, "com.google.one.fixture"]);
  const result = run("g1-acq.js", { body });
  assert.deepEqual(JSON.parse(result.payload.body), [TARGET, TARGET, TWENTY_TARGET, THIRTY_TARGET, "com.google.one.fixture"]);
  const scan = get(result.storage, SCAN_KEY);
  assert.equal(scan.version, "g1-acq-v8.1");
  assert.deepEqual(scan.skus.map(row => row.id), ["com.google.one.fixture", TWENTY, SOURCE, THIRTY]);
  assert.equal(scan.skus.find(row => row.id === SOURCE).count, 2);
  assert.deepEqual(result.writes, [SCAN_KEY, TEST_KEY]);
});

test("single-module collection decodes discovery copies and continues mapping when the list is full", () => {
  const escaped = String.raw`g1\u002eios\u002e2tb\u002eescaped`;
  const decoded = run("g1-acq.js", { body: escaped });
  assert.deepEqual(decoded.payload, {});
  assert.equal(get(decoded.storage, SCAN_KEY).skus[0].id, "g1.ios.2tb.escaped");
  const storage = new Map();
  const full = Array.from({ length: 305 }, (_, index) => "g1.fixture." + index).join(" ");
  run("g1-acq.js", { url: "https://one.google.com/plans", body: full, storage });
  const fullEvent = get(storage, SCAN_KEY).recentResponses.at(-1);
  assert.equal(fullEvent.status, "new-skus");
  assert.equal(fullEvent.candidateCount, 305);
  assert.equal(fullEvent.addedCount, 300);
  assert.equal(fullEvent.omittedCount, 5);
  const next = run("g1-acq.js", { body: SOURCE + " g1.fixture.0", storage });
  assert.equal(next.payload.body, TARGET + " g1.fixture.0");
  const scan = get(storage, SCAN_KEY);
  assert.equal(scan.skus.length, 300);
  assert.equal(scan.truncated, true);
  assert.equal(scan.scannedResponses, 2);
  assert.equal(scan.skus.find(row => row.id === "g1.fixture.0").count, 2);
  assert.equal(scan.recentResponses.at(-1).status, "limit-reached");
  assert.equal(scan.recentResponses.at(-1).candidateCount, 2);
  assert.equal(scan.recentResponses.at(-1).addedCount, 0);
  assert.equal(scan.recentResponses.at(-1).omittedCount, 1);
});

test("activity distinguishes new IDs, repeated IDs, empty text and nontext responses", () => {
  const storage = new Map();
  const url = "https://one.google.com/support/help?token=private-token";
  const body = [SOURCE, SOURCE, OTHER_SOURCE].join(" ");
  run("g1-acq.js", { url, body, storage });
  let scan = get(storage, SCAN_KEY);
  assert.equal(scan.recentResponses[0].status, "new-skus");
  assert.equal(scan.recentResponses[0].candidateCount, 2);
  assert.equal(scan.recentResponses[0].addedCount, 2);
  run("g1-acq.js", { url, body, storage });
  scan = get(storage, SCAN_KEY);
  assert.equal(scan.skus.length, 2);
  assert.equal(scan.skus.find(row => row.id === SOURCE).count, 4);
  assert.equal(scan.scannedResponses, 2);
  assert.equal(scan.matchedResponses, 2);
  assert.equal(scan.recentResponses.at(-1).status, "known-skus");
  assert.equal(scan.recentResponses.at(-1).candidateCount, 2);
  assert.equal(scan.recentResponses.at(-1).addedCount, 0);
  run("g1-acq.js", { url, body: "no product in this response", storage });
  run("g1-acq.js", { url, body: undefined, storage });
  scan = get(storage, SCAN_KEY);
  assert.deepEqual(scan.recentResponses.map(event => event.status), ["new-skus", "known-skus", "no-skus", "non-text"]);
  assert.equal(scan.scannedResponses, 3);
  assert.equal(scan.matchedResponses, 2);
  assert.equal(scan.nonTextResponses, 1);
  assert.equal(scan.skus.length, 2);
  assert.equal(scan.recentResponses.at(-1).bodyType, "non-text");
  assert.equal(scan.recentResponses.at(-1).candidateCount, 0);
  assert.equal(storage.has(TEST_KEY), false, "non-rewrite pages preserve the mapping record");
  assert(!storage.get(SCAN_KEY).includes("private-token"));
  const data = JSON.parse(run("g1-sku-report.js", { url: REPORT + "?format=json", storage }).payload.response.body);
  assert.deepEqual(data.scan.recentResponses, scan.recentResponses);
  assert.equal(data.scan.nonTextResponses, 1);
  const html = run("g1-sku-report.js", { url: REPORT, storage }).payload.response.body;
  assert(html.includes("实际采集脚本：<code>g1-acq-v8.1</code>"));
  assert(html.includes("编号与已有记录重复"));
  assert(html.includes("正文不是可扫描文本"));
});

test("recent activity keeps ten arrivals and redacts URLs, extra fields and malformed events", () => {
  const valid = {
    at: "2099-01-01T00:00:00.000Z", path: "/ai", bodyType: "text", status: "no-skus",
    candidateCount: 0, addedCount: 0, omittedCount: 0, body: "private-history-body"
  };
  const storage = new Map([[SCAN_KEY, JSON.stringify({
    schemaVersion: 1, recentResponses: [valid, { ...valid, path: "/private-secret" }, { ...valid, status: "bad-status" }]
  })]]);
  run("g1-acq.js", { url: "https://one.google.com/plans?secret=1", body: SOURCE, storage });
  let scan = get(storage, SCAN_KEY);
  assert.equal(scan.recentResponses.length, 2);
  assert.equal(scan.recentResponses[0].at, valid.at);
  assert.equal(scan.recentResponses.at(-1).path, "/plans", "last received event stays last even after a clock change");
  const paths = ["/", "/ai/", "/plans/", "/_/GoogleOne/account-secret/data/batchexecute", "/account/private@example.test"];
  const expected = ["/", "/ai", "/plans", "/_/…/data/batchexecute", "[其他 one.google.com 路径]"];
  for (let index = 0; index < 14; index++) {
    run("g1-acq.js", { url: "https://one.google.com" + paths[index % 5] + "?secret=query#private-fragment", body: SOURCE, storage });
  }
  scan = get(storage, SCAN_KEY);
  assert.equal(scan.recentResponses.length, 10);
  assert.deepEqual(scan.recentResponses.map(event => event.path), Array.from({ length: 10 }, (_, index) => expected[(index + 4) % 5]));
  assert(scan.recentResponses.every(event => event.status === "known-skus" && event.addedCount === 0));
  for (const forbidden of ["private-history-body", "private-secret", "account-secret", "private@example.test", "query", "private-fragment", "secret="]) {
    assert(!storage.get(SCAN_KEY).includes(forbidden));
  }
});

test("old scan records remain old until an actual response creates a new diagnostic event", () => {
  const old = {
    schemaVersion: 1, version: "g1-acq-v7.1", updatedAt: "2026-11-23T07:40:18.464Z",
    scannedResponses: 5, matchedResponses: 1,
    skus: [{ id: SOURCE, count: 4, lastSeen: "2026-11-23T07:40:06.325Z" }]
  };
  const storage = new Map([[SCAN_KEY, JSON.stringify(old)]]);
  const before = storage.get(SCAN_KEY);
  let data = JSON.parse(run("g1-sku-report.js", { url: REPORT + "?format=json", storage }).payload.response.body);
  assert.equal(data.scan.version, "g1-acq-v7.1");
  assert.deepEqual(data.scan.recentResponses, []);
  assert.equal(data.scan.scannedResponses, 5);
  assert.equal(storage.get(SCAN_KEY), before);
  const html = run("g1-sku-report.js", { url: REPORT, storage }).payload.response.body;
  assert(html.includes("旧采集记录；尚未保存本版采集响应记录"));
  run("g1-acq.js", { url: "https://one.google.com/plans", body: SOURCE, storage });
  data = JSON.parse(run("g1-sku-report.js", { url: REPORT + "?format=json", storage }).payload.response.body);
  assert.equal(data.scan.version, "g1-acq-v8.1");
  assert.equal(data.scan.scannedResponses, 6);
  assert.equal(data.scan.matchedResponses, 2);
  assert.equal(data.scan.skus.length, 1);
  assert.equal(data.scan.skus[0].count, 5);
  assert.equal(data.scan.recentResponses.length, 1);
  assert.equal(data.scan.recentResponses[0].status, "known-skus");
  assert.equal(data.scan.recentResponses[0].addedCount, 0);
});

test("activity export rejects malformed metadata and excludes untrusted extra fields", () => {
  const event = {
    at: "2026-11-23T07:40:06.325Z", path: "/plans", bodyType: "text", status: "known-skus",
    candidateCount: 2, addedCount: 0, omittedCount: 0, body: "private-body", query: "private-token"
  };
  const storage = new Map([[SCAN_KEY, JSON.stringify({
    schemaVersion: 1, version: "g1-acq-v8.1",
    recentResponses: [event, { ...event, at: "<script>private</script>" }, { ...event, status: "constructor" }, { ...event, bodyType: "unknown" }]
  })]]);
  const result = run("g1-sku-report.js", { url: REPORT + "?format=json", storage });
  const data = JSON.parse(result.payload.response.body);
  assert.deepEqual(data.scan.recentResponses, [{
    at: event.at, path: event.path, bodyType: "text", status: "known-skus", candidateCount: 2, addedCount: 0, omittedCount: 0
  }]);
  assert(!result.payload.response.body.includes("private"));
});

test("storage errors do not prevent a matched response from completing", () => {
  for (const flags of [{ storageAvailable: false }, { storageThrows: true }, { storageWriteFails: true }]) {
    const result = run("g1-acq.js", { body: SOURCE, ...flags });
    assert.equal(result.payload.body, TARGET);
  }
});

test("test records omit cookies, headers and full response data", () => {
  const result = run("g1-acq.js", { body: JSON.stringify({ sku: SOURCE, email: "private@example.test" }) });
  const saved = result.storage.get(TEST_KEY);
  assert(!saved.includes("private@example.test"));
  assert(!saved.includes("secret"));
  assert.deepEqual(result.reads, [SCAN_KEY]);
  assert(!result.storage.get(SCAN_KEY).includes("private@example.test"));
  assert(!result.storage.get(SCAN_KEY).includes("secret"));
});

test("collector discovers IDs and escaped dots while preserving the response", () => {
  const body = JSON.stringify([
    SOURCE, SOURCE, TARGET, "com.google.one.2tb.fixture.iog", "private@example.test"
  ]) + String.raw` "g1\u002eios\u002e2tb\u002eescaped" "g1&#46;2tb&#46;html"`;
  const result = run("g1-sku-scan.js", { body });
  assert.deepEqual(result.payload, {});
  const state = get(result.storage, SCAN_KEY);
  assert.equal(state.scannedResponses, 1);
  assert.equal(state.matchedResponses, 1);
  assert.equal(state.skus.length, 5);
  assert.equal(state.skus.find(row => row.id === SOURCE).count, 2);
  assert(state.skus.some(row => row.id === "g1.ios.2tb.escaped"));
  assert(state.skus.some(row => row.id === "g1.2tb.html"));
  assert(!JSON.stringify(state).includes("private@example.test"));
  assert(!JSON.stringify(state).includes("secret"));
});

test("collector accumulates prior records and recovers corrupt storage", () => {
  const storage = new Map([[SCAN_KEY, "corrupt JSON"]]);
  run("g1-sku-scan.js", { body: SOURCE, storage });
  run("g1-sku-scan.js", { url: "https://one.google.com/plans", body: SOURCE + " " + TARGET, storage });
  const state = get(storage, SCAN_KEY);
  assert.equal(state.scannedResponses, 2);
  assert.equal(state.skus.length, 2);
  assert.equal(state.skus.find(row => row.id === SOURCE).count, 2);
});

test("collector bounds stored candidates at 300 and still counts existing IDs", () => {
  const body = Array.from({ length: 305 }, (_, index) => "g1.fixture." + index).join(" ");
  const result = run("g1-sku-scan.js", { body });
  assert.equal(get(result.storage, SCAN_KEY).skus.length, 300);
  assert.equal(get(result.storage, SCAN_KEY).truncated, true);
  run("g1-sku-scan.js", { body: "g1.fixture.0", storage: result.storage });
  assert.equal(get(result.storage, SCAN_KEY).skus.find(row => row.id === "g1.fixture.0").count, 2);
});

test("collector skips the local report, other domains and nontext bodies", () => {
  for (const options of [
    { url: REPORT, body: SOURCE },
    { url: REPORT + "?format=json", body: SOURCE },
    { url: REPORT + "/", body: SOURCE },
    { url: REPORT + "/?format=json", body: SOURCE },
    { url: "https://one.google.com.evil/ai?x=1", body: SOURCE },
    { body: undefined }, { body: new Uint8Array([1, 2]) }
  ]) {
    const result = run("g1-sku-scan.js", options);
    assert.deepEqual(result.payload, {});
    assert.equal(result.storage.size, 0);
  }
});

test("collector passes through on storage failure", () => {
  const result = run("g1-sku-scan.js", { body: SOURCE, storageThrows: true });
  assert.deepEqual(result.payload, {});
  assert(result.logs.some(line => line.includes("saved=no")));
});

test("report displays captured IDs and test sources without external assets", () => {
  const storage = new Map();
  run("g1-sku-scan.js", { body: SOURCE, storage });
  run("g1-acq.js", { body: SOURCE, storage });
  const { payload } = run("g1-sku-report.js", { url: REPORT, storage });
  assert.equal(payload.response.status, 200);
  assert.match(payload.response.body, /Google One SKU 本地报告/);
  assert(payload.response.body.includes(SOURCE));
  assert(payload.response.body.includes(TARGET));
  assert(payload.response.body.includes("本机脚本已接管 · v8.1.0"));
  assert.match(payload.response.body, /<button\b[^>]*name=format[^>]*value=json[^>]*>导出 JSON<\/button>/);
  assert(!/<(?:script|img|iframe)\b/i.test(payload.response.body));
  assert.equal(payload.response.headers["Cache-Control"], "no-store");
});

test("report export form resolves to a JSON attachment and supports a trailing slash", () => {
  const storage = new Map();
  run("g1-acq.js", { body: SOURCE, storage });
  const html = run("g1-sku-report.js", { url: REPORT + "/", storage }).payload.response.body;
  const action = html.match(/<form method=get action="([^"]+)"><button type=submit name=format value=json>/);
  assert(action, "the visible export button must submit a GET form");
  const url = new URL(action[1]);
  url.searchParams.set("format", "json");
  assert.equal(url.href, REPORT + "?format=json");
  for (const exportURL of [url.href, REPORT + "/?format=json"]) {
    const result = run("g1-sku-report.js", { url: exportURL, storage });
    assert.equal(result.payload.response.status, 200);
    assert.equal(result.payload.response.headers["Content-Disposition"], 'attachment; filename="g1-sku-report.json"');
    assert.equal(result.payload.response.headers["X-G1-Report-Version"], "v8.1.0");
    const data = JSON.parse(result.payload.response.body);
    assert.equal(data.reportVersion, "v8.1.0");
    assert.equal(data.configuredTarget, TARGET);
    assert.equal(data.test.target, TARGET);
    assert.equal(data.test.targetOrigin, "user-specified");
    assert.equal(data.scan.skus[0].id, SOURCE);
    assert.equal(data.test.matchedFrom[0].to, TARGET);
    assert(result.logs.some(line => line.includes("[g1-sku-report] v8.1.0 json")));
  }
});

test("report exports each actual target and separates annual hits from total hits", () => {
  const storage = new Map();
  run("g1-acq.js", {
    body: JSON.stringify([SOURCE, TWENTY, THIRTY, THIRTY_FALLBACK]), storage
  });
  const result = run("g1-sku-report.js", { url: REPORT + "?format=json", storage });
  const data = JSON.parse(result.payload.response.body).test;
  assert.equal(data.version, "g1-acq-v8.1");
  assert.equal(data.hitCount, 3);
  assert.equal(data.annualHitCount, 1);
  assert.equal(data.matchedFrom.find(row => row.id === TWENTY).to, TWENTY_TARGET);
  assert.deepEqual(data.matchedFrom.find(row => row.id === THIRTY), {
    id: THIRTY, count: 1, to: THIRTY_FALLBACK, fallback: true
  });
  const html = run("g1-sku-report.js", { url: REPORT, storage }).payload.response.body;
  assert(html.includes("最近一次三档映射"));
  assert(html.includes("其中 2TB：1"));
  assert(html.includes(TWENTY_TARGET));
  assert(html.includes(THIRTY_FALLBACK));
});

test("new report displays existing v1 records with their original 2TB target", () => {
  const storage = new Map([[TEST_KEY, JSON.stringify({
    schemaVersion: 1, version: "pro-annual-test-v1", hitCount: 2, status: "rewritten",
    matchedFrom: [{ id: SOURCE, count: 2 }]
  })]]);
  const result = run("g1-sku-report.js", { url: REPORT + "?format=json", storage });
  const data = JSON.parse(result.payload.response.body).test;
  assert.equal(data.version, "pro-annual-test-v1");
  assert.equal(data.hitCount, 2);
  assert.equal(data.annualHitCount, 2);
  assert.equal(data.target, LEGACY_TARGET);
  assert.equal(data.targetOrigin, "legacy");
  assert.deepEqual(data.matchedFrom, [{ id: SOURCE, count: 2, to: LEGACY_TARGET, fallback: false }]);
  storage.set(TEST_KEY, JSON.stringify({
    schemaVersion: 1, version: "pro-annual-test-v1", hitCount: 0,
    status: "no-match", matchedFrom: []
  }));
  const html = run("g1-sku-report.js", { url: REPORT, storage }).payload.response.body;
  assert(html.includes("旧 v1 记录：本次响应未命中 iOS 2TB 前缀"));
});

test("report preserves saved v7.1 through v7.5 targets and origins independently of current configuration", () => {
  for (const prior of [
    { version: "g1-acq-v7.1", target: LEGACY_TARGET, origin: "legacy" },
    { version: "g1-acq-v7.2", target: "g1.2tb.ai.annual.3months_ip_90p.acq", origin: "pattern-derived" },
    { version: "g1-acq-v7.3", target: "g1.2tb.ai.annual_ip_90p.acq", origin: "user-specified" },
    { version: "g1-acq-v7.4", target: "g1.2tb.ai.annual_ip_90p.acq", origin: "user-specified" },
    { version: "g1-acq-v7.5", target: TARGET, origin: "user-specified" }
  ]) {
    const record = {
      schemaVersion: 1, version: prior.version, target: prior.target,
      status: "rewritten", hitCount: 9, annualHitCount: 9,
      matchedFrom: [{ id: "g1.ios.2tb.ai.a", to: prior.target, count: 9, fallback: false }]
    };
    if (prior.origin !== "legacy") record.targetOrigin = prior.origin;
    const storage = new Map([[TEST_KEY, JSON.stringify(record)]]);
    const before = storage.get(TEST_KEY);
    const data = JSON.parse(run("g1-sku-report.js", { url: REPORT + "?format=json", storage }).payload.response.body);
    assert.equal(data.configuredTarget, TARGET);
    assert.equal(data.test.version, prior.version);
    assert.equal(data.test.target, prior.target);
    assert.equal(data.test.targetOrigin, prior.origin);
    assert.equal(data.test.matchedFrom[0].to, prior.target);
    assert.equal(storage.get(TEST_KEY), before);
    const html = run("g1-sku-report.js", { url: REPORT, storage }).payload.response.body;
    assert(html.includes("当前配置的 2TB 候选目标：<code>" + TARGET + "</code>"));
    assert(html.includes("该次记录的 2TB 目标：<code>" + prior.target + "</code>"));
  }
  const empty = JSON.parse(run("g1-sku-report.js", { url: REPORT + "?format=json" }).payload.response.body);
  assert.equal(empty.configuredTarget, TARGET);
  assert.equal(empty.test.target, "");
  assert.equal(empty.test.targetOrigin, "");
  assert.equal(empty.test.status, "");
});

test("JSON export is limited to report fields and escapes untrusted HTML text", () => {
  const storage = new Map([[SCAN_KEY, JSON.stringify({
    schemaVersion: 1, updatedAt: "<script>fixture</script>", scannedResponses: 1,
    secret: "must-not-export", body: "must-not-export",
    skus: [{ id: SOURCE, count: 2, lastSeen: "<img src=x>", secret: "must-not-export" }]
  })]]);
  const jsonResult = run("g1-sku-report.js", { url: REPORT + "?format=json", storage });
  assert.match(jsonResult.payload.response.headers["Content-Type"], /application\/json/);
  const report = JSON.parse(jsonResult.payload.response.body);
  assert.equal(report.scan.skus[0].id, SOURCE);
  assert(!jsonResult.payload.response.body.includes("must-not-export"));
  const htmlResult = run("g1-sku-report.js", { url: REPORT, storage });
  assert(!htmlResult.payload.response.body.includes("<script>fixture"));
  assert(htmlResult.payload.response.body.includes("&lt;img src=x&gt;"));
});

test("clear action affects only the tool's two storage keys", () => {
  const storage = new Map([
    [SCAN_KEY, JSON.stringify({ schemaVersion: 1, skus: [{ id: SOURCE, count: 1 }] })],
    [TEST_KEY, JSON.stringify({ schemaVersion: 1, hitCount: 1 })],
    ["other-tool", "untouched"]
  ]);
  const result = run("g1-sku-report.js", { url: REPORT + "?clear=1", storage });
  assert.deepEqual(get(storage, SCAN_KEY), {});
  assert.deepEqual(get(storage, TEST_KEY), {});
  assert.equal(storage.get("other-tool"), "untouched");
  assert.deepEqual(new Set(result.reads), new Set([SCAN_KEY, TEST_KEY]));
});

test("report handles unavailable storage and skips other URL paths", () => {
  const unavailable = run("g1-sku-report.js", { url: REPORT + "?format=json", storageAvailable: false });
  assert.equal(JSON.parse(unavailable.payload.response.body).storageAvailable, false);
  for (const url of ["https://one.google.com/ai?x=1", REPORT + "-other", "https://example.test/g1-sku-report"]) {
    const result = run("g1-sku-report.js", { url });
    assert.deepEqual(result.payload, {});
    assert.deepEqual(result.reads, []);
  }
});

test("the new installer replaces the old entry and legacy modules share one fixed release", () => {
  assert.equal(fs.existsSync(path.join(root, "g1-acq.sgmodule")), false);
  let scriptBase;
  for (const file of ["g1-pro-annual-test.sgmodule", "g1-sku-scan.sgmodule"]) {
    const module = fs.readFileSync(path.join(root, file), "utf8");
    const scripts = module.split("\n").filter(line => line.includes("script-path="));
    assert.equal(scripts.length, 2);
    for (const script of scripts) {
      const url = script.match(/script-path=([^,\s]+)/)[1];
      assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\/gh\/crhywun\/g1-acq@v7\.5\.0\/[a-z0-9.-]+\.js$/);
      const base = url.slice(0, url.lastIndexOf("/") + 1);
      if (!scriptBase) scriptBase = base;
      assert.equal(base, scriptBase);
      assert(fs.existsSync(path.join(root, url.split("/").at(-1))));
    }
    assert.match(module, /hostname = %APPEND% one\.google\.com/);
    const responseLine = scripts.find(line => line.includes("type=http-response"));
    const pattern = new RegExp(responseLine.match(/pattern=([^,]+)/)[1]);
    assert(pattern.test("https://one.google.com/ai?x=1"));
    assert(!pattern.test("https://one.google.com.evil/ai?x=1"));
    assert.equal(pattern.test("https://one.google.com/plans"), file !== "g1-pro-annual-test.sgmodule");
    assert.equal(pattern.test("https://one.google.com/ai"), file !== "g1-pro-annual-test.sgmodule");
    if (file !== "g1-sku-scan.sgmodule") {
      assert.equal(responseLine.match(/script-path=([^,\s]+)/)[1],
        scriptBase + "g1-acq.js");
    }
    const requestLine = scripts.find(line => line.includes("type=http-request"));
    assert.equal(requestLine.match(/script-path=([^,\s]+)/)[1],
      scriptBase + "g1-sku-report.js");
    const reportPattern = new RegExp(requestLine.match(/pattern=([^,]+)/)[1]);
    for (const url of [REPORT, REPORT + "?format=json", REPORT + "/", REPORT + "/?format=json"]) {
      assert(reportPattern.test(url));
    }
    for (const url of [REPORT + "-other", REPORT + "/other", "https://one.google.com.evil/g1-sku-report"]) {
      assert(!reportPattern.test(url));
    }
  }
});

test("g1-acq-v8.sgmodule enables Web routes, jsDelivr @v8.1.0 scripts, and custom proxy routing", () => {
  assert.equal(fs.existsSync(path.join(root, "g1-acq-v7.sgmodule")), false);
  const module = fs.readFileSync(path.join(root, "g1-acq-v8.sgmodule"), "utf8");
  assert.match(module, /^#!name=G1 ACQ$/m);
  assert.match(module, /^#!system=ios,macos$/m);
  const argsLine = module.match(/^#!arguments=(.+)$/m);
  assert(argsLine, "#!arguments header must exist");
  const defaults = Object.fromEntries(
    argsLine[1].split(",").map(entry => {
      const sep = entry.indexOf(":");
      assert(sep > 0, "argument entry must use key:default format: " + entry);
      return [entry.slice(0, sep).trim(), entry.slice(sep + 1).trim()];
    })
  );
  assert.deepEqual(defaults, {
    PROXY_POLICY: "PROXY",
    REWRITE_WEB: "true"
  });
  assert.match(module, /^#!arguments-desc=.*PROXY_POLICY:/m);

  const expand = (line, overrides = {}) => {
    const vars = { ...defaults, ...overrides };
    return line.replace(/\{\{\{([A-Za-z0-9_]+)\}\}\}/g, (_, k) => vars[k]);
  };

  assert.match(module, /^AND,\(\(PROTOCOL,UDP\),\(DEST-PORT,443\)\),REJECT-NO-DROP$/m);
  for (const [ruleType, host] of [
    ["DOMAIN-SUFFIX", "one.google.com"],
    ["DOMAIN-SUFFIX", "payments.google.com"],
    ["DOMAIN-SUFFIX", "pay.google.com"],
    ["DOMAIN-SUFFIX", "play.google.com"],
    ["DOMAIN", "googleone-pa.googleapis.com"]
  ]) {
    const rawRule = `${ruleType},${host},{{{PROXY_POLICY}}}`;
    assert(module.includes(rawRule), "missing custom proxy rule: " + rawRule);
    assert.equal(expand(rawRule, { PROXY_POLICY: "MyCustomProxy" }), `${ruleType},${host},MyCustomProxy`);
  }

  const scripts = module.split("\n").filter(line => line.includes("script-path="));
  assert.equal(scripts.length, 4);
  const byName = Object.fromEntries(
    scripts.map(line => [line.split("=")[0].trim(), expand(line)])
  );
  assert.equal(
    byName["g1-acq"].match(/script-path=([^,\s]+)/)[1],
    "https://cdn.jsdelivr.net/gh/nguyentruong190/g1-acq@v8.1.0/g1-acq.js"
  );
  assert.equal(
    byName["g1-acq-req"].match(/script-path=([^,\s]+)/)[1],
    "https://cdn.jsdelivr.net/gh/nguyentruong190/g1-acq@v8.1.0/g1-acq.js"
  );
  assert.equal(
    byName["g1-acq-checkout"].match(/script-path=([^,\s]+)/)[1],
    "https://cdn.jsdelivr.net/gh/nguyentruong190/g1-acq@v8.1.0/g1-acq.js"
  );
  assert.equal(
    byName["g1-sku-report"].match(/script-path=([^,\s]+)/)[1],
    "https://cdn.jsdelivr.net/gh/nguyentruong190/g1-acq@v8.1.0/g1-sku-report.js"
  );
  assert(fs.existsSync(path.join(root, "g1-acq.js")));
  assert(fs.existsSync(path.join(root, "g1-sku-report.js")));
  assert.match(byName["g1-acq"], /argument="rewriteWeb=true"/);
  assert.match(byName["g1-acq-req"], /type=http-request/);
  assert.match(byName["g1-acq-req"], /requires-body=1/);
  assert.match(byName["g1-acq-checkout"], /type=http-request/);

  const responsePattern = new RegExp(byName["g1-acq"].match(/pattern=([^,]+)/)[1]);
  assert(responsePattern.test("https://one.google.com/"));
  assert(responsePattern.test("https://one.google.com/u/0/plans?hl=vi"));
  assert(responsePattern.test("https://one.google.com/_/GoogleOneWebUi/data/batchexecute"));
  assert(!responsePattern.test("https://one.google.com.evil/plans"));

  const reqBatchPattern = new RegExp(byName["g1-acq-req"].match(/pattern=([^,]+)/)[1]);
  assert(reqBatchPattern.test("https://one.google.com/_/GoogleOneWebUi/data/batchexecute?rpcids=Ngbm"));
  assert(reqBatchPattern.test("https://one.google.com/u/1/_/GoogleOneWebUi/data/batchexecute"));
  assert(!reqBatchPattern.test("https://one.google.com/plans"));

  const checkoutPattern = new RegExp(byName["g1-acq-checkout"].match(/pattern=([^,]+)/)[1]);
  assert(checkoutPattern.test("https://tokenized.play.google.com/eacquire/multiline?authuser=0&ear=%5B%5D"));
  assert(!checkoutPattern.test("https://play.google.com/store"));

  const reportPattern = new RegExp(byName["g1-sku-report"].match(/pattern=([^,]+)/)[1]);
  for (const url of [REPORT, REPORT + "?format=json", REPORT + "/", REPORT + "/?format=json"]) {
    assert(reportPattern.test(url));
  }
  assert.match(module, /^hostname = %APPEND% one\.google\.com, tokenized\.play\.google\.com$/m);
});

test("web routes and multi-account paths rewrite and redact path categories safely", () => {
  const routes = [
    ["https://one.google.com/", "/"],
    ["https://one.google.com/ai", "/ai"],
    ["https://one.google.com/ai/plans", "/ai"],
    ["https://one.google.com/ai-plans", "/ai"],
    ["https://one.google.com/plans", "/plans"],
    ["https://one.google.com/u/0/plans?hl=vi", "/plans"],
    ["https://one.google.com/u/2/ai", "/ai"],
    ["https://one.google.com/upgrade", "/upgrade"],
    ["https://one.google.com/u/0/upgrade?hl=vi", "/upgrade"],
    ["https://one.google.com/settings", "/settings"],
    ["https://one.google.com/u/1/settings", "/settings"],
    ["https://one.google.com/buy/pro", "/checkout"],
    ["https://one.google.com/checkout/plan", "/checkout"],
    ["https://one.google.com/subscribe/pro", "/checkout"],
    ["https://one.google.com/acquire/offer", "/checkout"],
    ["https://one.google.com/about/google-ai-plans/", "/about"],
    ["https://one.google.com/explore-plan/pro", "/explore-plan"],
    ["https://one.google.com/offer/abc", "/offer"],
    ["https://one.google.com/storage", "/storage"],
    ["https://one.google.com/_/GoogleOneWebUi/data/batchexecute?rpcids=x", "/_/…/data/batchexecute"],
    ["https://one.google.com/u/0/_/GoogleOneWebUi/data/batchexecute", "/_/…/data/batchexecute"]
  ];
  for (const [url, expectedPath] of routes) {
    const storage = new Map();
    const res = run("g1-acq.js", { url, body: JSON.stringify(["g1.2tb.ai"]), storage });
    assert.deepEqual(JSON.parse(res.payload.body), [TARGET], "should rewrite on " + url);
    const scan = get(storage, SCAN_KEY);
    assert.equal(scan.recentResponses[0].path, expectedPath);
    assert(!storage.get(SCAN_KEY).includes("/u/2"));
    assert(!storage.get(SCAN_KEY).includes("hl=vi"));
    assert(!storage.get(SCAN_KEY).includes("google-ai-plans"));
    const reportJson = JSON.parse(run("g1-sku-report.js", { url: REPORT + "?format=json", storage }).payload.response.body);
    assert.equal(reportJson.scan.recentResponses[0].path, expectedPath);
  }
  const privateSub = run("g1-acq.js", {
    url: "https://one.google.com/u/2/private-subpath?secret=1",
    body: SOURCE
  });
  assert.deepEqual(privateSub.payload, {});
  assert.equal(get(privateSub.storage, SCAN_KEY).recentResponses[0].path, "[其他 one.google.com 路径]");
  assert(!privateSub.storage.get(SCAN_KEY).includes("/u/2"));
  assert(!privateSub.storage.get(SCAN_KEY).includes("private-subpath"));
});

test("web SKUs map with fallback, escaped JSON, Play prefix, and unexpanded argument safety", () => {
  const untouched = ["g1.2tb", TARGET, "g1.2tb.ai.subs_variant", "g1.20tb.v2.extra"];
  const input = [
    "g1.2tb.ai",
    "g1.2tb.ai.annual",
    "g1.play.2tb.ai",
    "g1.20tb",
    "g1.20tb.v2",
    "g1.play.20tb",
    "g1.ai.pro",
    "g1.30tb",
    "g1.play.ai.pro",
    ...untouched
  ];
  const primaryRes = run("g1-acq.js", {
    url: "https://one.google.com/u/0/plans?hl=vi",
    body: JSON.stringify(input),
    argument: "rewriteWeb={{{REWRITE_WEB}}}"
  });
  assert.deepEqual(JSON.parse(primaryRes.payload.body), [
    TARGET, TARGET, TARGET,
    TWENTY_TARGET, TWENTY_TARGET, TWENTY_TARGET,
    THIRTY_TARGET, THIRTY_TARGET, THIRTY_TARGET,
    ...untouched
  ]);
  const record = get(primaryRes.storage, TEST_KEY);
  assert.equal(record.hitCount, 9);
  assert.equal(record.annualHitCount, 3);

  const fallbackRes = run("g1-acq.js", {
    url: "https://one.google.com/_/GoogleOneWebUi/data/batchexecute",
    body: '["\\"g1.2tb.ai\\"","subs:com.google.android.apps.subscriptions.red:g1.play.20tb","g1.30tb","' + THIRTY_FALLBACK + '"]'
  });
  assert.equal(
    fallbackRes.payload.body,
    '["\\"' + TARGET + '\\"","subs:com.google.android.apps.subscriptions.red:' + TWENTY_TARGET + '","' + THIRTY_FALLBACK + '","' + THIRTY_FALLBACK + '"]'
  );
  const fbRows = get(fallbackRes.storage, TEST_KEY).matchedFrom;
  assert.equal(fbRows.find(row => row.id === "g1.30tb").fallback, true);
  assert.equal(fbRows.find(row => row.id === "g1.play.20tb").fallback, false);
});

test("batchexecute response recalculates chunk length prefixes without corrupting JSON or Unicode", () => {
  const chunk1 = JSON.stringify([["wrb.fr", "abc", JSON.stringify(["₫489,000", "g1.2tb.ai", "g1.20tb"]), null, null, null, "1"]]);
  const chunk2 = JSON.stringify([["wrb.fr", "def", JSON.stringify(["g1.ai.pro"]), null, null, null, "2"]]);
  const chunk3 = JSON.stringify([["di", 42]]);
  const framed = [
    ")]}'",
    "",
    String(Buffer.byteLength(chunk1, "utf8")),
    chunk1,
    String(chunk2.length),
    chunk2,
    String(chunk3.length),
    chunk3,
    ""
  ].join("\n");

  const storage = new Map();
  const res = run("g1-acq.js", {
    url: "https://one.google.com/u/0/_/GoogleOneWebUi/data/batchexecute?rt=c",
    body: framed,
    storage
  });
  const lines = res.payload.body.split("\n");
  assert.equal(lines[0], ")]}'");
  assert.equal(lines[1], "");
  assert.equal(Number(lines[2]), Buffer.byteLength(lines[3], "utf8"));
  assert.equal(Number(lines[4]), lines[5].length);
  assert.equal(Number(lines[6]), lines[7].length);
  assert.equal(lines[7], chunk3);
  assert(lines[3].includes(TARGET));
  assert(lines[3].includes(TWENTY_TARGET));
  assert(lines[3].includes("₫489,000"));
  assert(lines[5].includes(THIRTY_TARGET));
  assert.doesNotThrow(() => JSON.parse(lines[3]));
  assert.doesNotThrow(() => JSON.parse(lines[5]));
  assert.doesNotThrow(() => JSON.parse(lines[7]));
  assert.equal(get(storage, TEST_KEY).hitCount, 3);
  assert.equal(get(storage, TEST_KEY).annualHitCount, 1);

  const unframed = ")]}'\n\n" + JSON.stringify([["wrb.fr", "ghi", JSON.stringify(["g1.2tb.ai"]), null, null, null, "1"]]);
  const unframedRes = run("g1-acq.js", {
    url: "https://one.google.com/_/GoogleOneWebUi/data/batchexecute",
    body: unframed
  });
  const parsedUnframed = JSON.parse(unframedRes.payload.body.slice(6));
  assert.deepEqual(JSON.parse(parsedUnframed[0][2]), [TARGET]);
});

test("http-request Ngbm batchexecute patches upgrade items, offer tokens, and mode=5", () => {
  const PRO_TOK = "AYrTWi7W8ZhHHzTZCLOtTLeN/Th2bL1VXWC0iWtQT8+2r4czXLlSZlHvbr8wJVXd7Z0IE//tsVOhqXZPDVTZyer/axAhjZ/A";
  const ULTRA_TOK = "AYrTWi6m390S5L8/v/68ytX7FGefqs730Fb8RMphQ9nHXjRga2FTIto3+rL6WvPp4kNgYB2aQTdKr8S4mI6ehGhrLWAW4tti";
  const prefix = "subs:com.google.android.apps.subscriptions.red:";
  const makeNode = (sku, oldTok, withSub) => {
    const node = new Array(13).fill(null);
    node[2] = [null, null, new Array(9).fill(null)];
    node[2][2][8] = [[[
      [prefix + sku, 21], null, null, null, 1, [oldTok]
    ]]];
    node[7] = withSub ? [null, 2, null, null, null, ["sub_active_123"]] : null;
    node[10] = [[[
      [prefix + sku, 21], null, null, null, 1, [oldTok]
    ]]];
    node[12] = [
      [[prefix + sku, 21], null, null, null, 1, [oldTok]],
      [[prefix + "g1.youtube_premium_individual_add_on", 21], null, null, null, 1, ["YT_TOK"]]
    ];
    return node;
  };

  const payload = [makeNode("g1.2tb.ai", "WRONG_TOK", true), makeNode("g1.20tb.3months_ip_75p.acq", "OLD_20", false)];
  const freq = [[[ "Ngbm", JSON.stringify(payload), null, "generic" ]]];
  const reqBody = "f.req=" + encodeURIComponent(JSON.stringify(freq)) + "&at=secret_xsrf";

  const res = run("g1-acq.js", {
    isRequest: true,
    url: "https://one.google.com/u/0/_/GoogleOneWebUi/data/batchexecute?rpcids=Ngbm",
    requestBody: reqBody
  });
  const outParams = new URLSearchParams(res.payload.body);
  assert.equal(outParams.get("at"), "secret_xsrf");
  const outOuter = JSON.parse(outParams.get("f.req"));
  const outPayload = JSON.parse(outOuter[0][0][1]);
  assert.equal(outPayload[0][12][0][0][0], prefix + TARGET);
  assert.deepEqual(outPayload[0][12][0][5], [PRO_TOK]);
  assert.equal(outPayload[0][12][1][0][0], prefix + "g1.youtube_premium_individual_add_on");
  assert.deepEqual(outPayload[0][12][1][5], ["YT_TOK"]);
  assert.equal(outPayload[0][7][1], 5);
  assert.equal(outPayload[0][10][0][0][0][0], prefix + TARGET);
  assert.deepEqual(outPayload[0][10][0][0][5], [PRO_TOK]);
  assert.equal(outPayload[0][2][2][8][0][0][0][0], prefix + TARGET);
  assert.deepEqual(outPayload[0][2][2][8][0][0][5], [PRO_TOK]);
  assert.equal(outPayload[1][12][0][0][0], prefix + TWENTY_FALLBACK);
  assert.deepEqual(outPayload[1][12][0][5], [ULTRA_TOK]);

  const untouchedFreq = [[[ "Ngbm", JSON.stringify([makeNode("g1.100gb", "KEEP_100", true)]), null, "generic" ]]];
  const untouchedRes = run("g1-acq.js", {
    isRequest: true,
    url: "https://one.google.com/_/GoogleOneWebUi/data/batchexecute",
    requestBody: "f.req=" + encodeURIComponent(JSON.stringify(untouchedFreq))
  });
  assert.deepEqual(untouchedRes.payload, {});

  const disabledRes = run("g1-acq.js", {
    isRequest: true,
    url: "https://one.google.com/_/GoogleOneWebUi/data/batchexecute",
    requestBody: reqBody,
    argument: "rewriteWeb=false"
  });
  assert.deepEqual(disabledRes.payload, {});
});

test("http-request tokenized.play.google.com/eacquire/multiline patches ear and base64 inner4 without Web globals", () => {
  const PRO_TOK = "AYrTWi7W8ZhHHzTZCLOtTLeN/Th2bL1VXWC0iWtQT8+2r4czXLlSZlHvbr8wJVXd7Z0IE//tsVOhqXZPDVTZyer/axAhjZ/A";
  const prefix = "subs:com.google.android.apps.subscriptions.red:";
  const inner4 = new Array(9).fill(null);
  inner4[8] = [[[[prefix + TARGET, 21], null, null, null, 1, ["STALE_TOK"]]]];

  const ear = new Array(25).fill(null);
  ear[4] = [Buffer.from(JSON.stringify(inner4), "utf8").toString("base64")];
  ear[8] = [null, 2, null, null, null, ["sub_old_999"]];
  ear[13] = [[[[prefix + "g1.2tb.ai", 21], null, null, null, 1, ["BAD_TOK"]]]];
  ear[24] = ["stale-proration"];

  const checkoutUrl = "https://tokenized.play.google.com/eacquire/multiline?authuser=0&ear=" +
    encodeURIComponent(JSON.stringify(ear)) + "&parent=https%3A%2F%2Fone.google.com";
  const res = run("g1-acq.js", {
    isRequest: true,
    url: checkoutUrl
  });
  const parsedUrl = new URL(res.payload.url);
  assert.equal(parsedUrl.searchParams.get("authuser"), "0");
  assert.equal(parsedUrl.searchParams.get("parent"), "https://one.google.com");
  const outEar = JSON.parse(parsedUrl.searchParams.get("ear"));
  assert.equal(outEar[13][0][0][0][0], prefix + TARGET);
  assert.deepEqual(outEar[13][0][0][5], [PRO_TOK]);
  assert.equal(outEar[8][1], 5);
  assert.equal(outEar[24], null);
  const outInner4 = JSON.parse(Buffer.from(outEar[4][0], "base64").toString("utf8"));
  assert.equal(outInner4[8][0][0][0][0], prefix + TARGET);
  assert.deepEqual(outInner4[8][0][0][5], [PRO_TOK]);

  const nonTargetEar = new Array(14).fill(null);
  nonTargetEar[13] = [[[[prefix + "g1.100gb", 21], null, null, null, 1, ["KEEP"]]]];
  const untouched = run("g1-acq.js", {
    isRequest: true,
    url: "https://tokenized.play.google.com/eacquire/multiline?ear=" + encodeURIComponent(JSON.stringify(nonTargetEar))
  });
  assert.deepEqual(untouched.payload, {});

  const disabled = run("g1-acq.js", {
    isRequest: true,
    url: checkoutUrl,
    argument: "rewriteWeb=false"
  });
  assert.deepEqual(disabled.payload, {});
});
