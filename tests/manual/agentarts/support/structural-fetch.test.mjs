import test from "node:test";
import assert from "node:assert/strict";
import {AgentArtsCloudAgentPort} from "../../../../packages/coordination/dist/index.js";

import {
  createStructuralDiagnosticFetch,
  STRUCTURAL_DIAGNOSTIC_LIMITS
} from "./structural-fetch.mjs";

const encoder = new TextEncoder();

test("SSE event arrays retain partial index coverage while the public port decides acceptance", async () => {
  for (const conflicting of [false, true]) {
    let calls = 0;
    const events = [
      {event: "message", data: {text: "ARRAY_PRIVATE_A", index: 0}},
      {event: "message", data: {text: conflicting ? "ARRAY_PRIVATE_B" : "ARRAY_PRIVATE_A", index: 0}}
    ];
    const diagnostic = createStructuralDiagnosticFetch(async () => {
      calls++;
      return new Response("data: " + JSON.stringify(events) + "\n\n", {
        headers: {"content-type": "text/event-stream"}
      });
    });
    const cloud = new AgentArtsCloudAgentPort({gatewayUrl: "https://synthetic.example.test", runtimeName: "synthetic"},
      {read: async () => "Bearer HEADER_CANARY"}, diagnostic.fetch);
    const run = cloud.invoke({taskId: "synthetic-array-probe", revision: 1, goal: "synthetic",
      deadline: new Date(Date.now() + 5000).toISOString(), signal: new AbortController().signal});
    if (conflicting) await assert.rejects(run, {code: "EXTERNAL_FAILURE"});
    else assert.equal((await run).text, "ARRAY_PRIVATE_A");
    const report = diagnostic.finish(), attempt = report.attempts[0];
    assert.equal(calls, 1);
    assert.equal(attempt.eventInspection, "sse_only");
    assert.equal(attempt.bodyOutcome, "complete");
    assert.equal(attempt.eventCounts.other, 1);
    assert.equal(attempt.eventCounts.message, 0);
    assert.equal(attempt.indexedMessages.coverage, "partial");
    assert.equal(attempt.indexedMessages.trackedIndexCountCapped, 0);
    assert.equal(attempt.indexedMessages.conflictObserved, false);
    assert.doesNotMatch(JSON.stringify(report), /ARRAY_PRIVATE|HEADER_CANARY/);
  }
});

test("iterator throw records rejection without changing the original error", async () => {
  const error = new Error("THROW_CANARY");
  const diagnostic = createStructuralDiagnosticFetch(async () => ({
    status: 200,
    body: {
      [Symbol.asyncIterator]() {
        return {
          async next() { return {done: true}; },
          async throw() { throw error; }
        };
      }
    }
  }));
  const response = await diagnostic.fetch();
  const iterator = response.body[Symbol.asyncIterator]();
  await assert.rejects(iterator.throw(error), thrown => thrown === error);
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].bodyOutcome, "rejected");
  assert.equal(JSON.stringify(report).includes("THROW_CANARY"), false);
});

test("JSON responses explicitly report that their events were not parsed", async () => {
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    new Response('[{"event":"task_end","data":{}}]', {
      headers: {"content-type": "application/json"}
    })
  );
  const response = await diagnostic.fetch();
  await consumeReader(response);
  response.headers.get("content-type");
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].eventInspection, "json_unparsed");
  assert.equal(report.attempts[0].indexedMessages.coverage, "partial");
  assert.deepEqual(report.attempts[0].eventWindow, {
    head: [],
    tail: [],
    truncated: false
  });
});

function createReader(chunks, failure) {
  let index = 0;
  return {
    async read() {
      if (failure && index === failure.at) {
        index += 1;
        throw failure.error;
      }
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    },
    releaseLock() {}
  };
}

function createResponse({
  chunks = [],
  contentType = "text/event-stream; charset=utf-8",
  status = 200,
  failure
} = {}) {
  return {
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      }
    },
    body: {
      getReader() {
        return createReader(chunks, failure);
      }
    }
  };
}

async function consumeReader(response) {
  const reader = response.body.getReader();
  const chunks = [];
  while (true) {
    const result = await reader.read();
    if (result.done) {
      return chunks;
    }
    chunks.push(result.value);
  }
}

function windowEvents(attempt) {
  return [...attempt.eventWindow.head, ...attempt.eventWindow.tail];
}

test("passes one request and original chunks while emitting only allowlisted structure", async () => {
  const secretUrl = "https://secret.invalid/path?token=URL_CANARY";
  const init = {
    headers: { authorization: "Bearer HEADER_CANARY" },
    body: "REQUEST_BODY_CANARY"
  };
  const first = encoder.encode(
    'data: {"event":"workflow_start","data":{"workflow_name":"PRIVATE_WORKFLOW"}}\n\n'
  );
  const second = encoder.encode(
    'data: {"event":"message","data":{"text":"PRIVATE_ANSWER"}}\n'
  );
  const third = encoder.encode(
    'data: {"event":"task_end","data":{"status":"success"}}\n\n'
  );
  let calls = 0;
  const innerFetch = async (url, passedInit) => {
    calls += 1;
    assert.equal(url, secretUrl);
    assert.equal(passedInit, init);
    return createResponse({ chunks: [first, second, third] });
  };
  const diagnostic = createStructuralDiagnosticFetch(innerFetch);

  const response = await diagnostic.fetch(secretUrl, init);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const output = await consumeReader(response);

  assert.equal(calls, 1);
  assert.deepEqual(output, [first, second, third]);
  assert.equal(output[0], first);
  assert.equal(output[1], second);
  assert.equal(output[2], third);

  const report = diagnostic.finish();
  assert.equal(report.schemaVersion, 2);
  assert.deepEqual(
    windowEvents(report.attempts[0]).map((event) => event.name),
    ["workflow_start", "message", "task_end"]
  );
  assert.equal(report.attempts[0].contentType, "text/event-stream");
  assert.equal(report.attempts[0].eventInspection, "sse_only");
  assert.equal(report.attempts[0].bodyOutcome, "complete");
  assert.equal(report.attempts[0].indexedMessages.coverage, "complete");
  assert.equal(report.attempts[0].eventWindow.head[1].data.text.type, "string");
  assert.equal(report.attempts[0].eventWindow.head[1].data.text.lengthCapped, 14);
  assert.equal(report.attempts[0].eventCounts.workflow_start, 1);
  assert.equal(report.attempts[0].eventCounts.message, 1);
  assert.equal(report.attempts[0].eventCounts.task_end, 1);
  assert.equal(report.attempts[0].textMetrics.messageText.stringCountCapped, 1);
  assert.equal(report.attempts[0].textMetrics.messageText.totalLengthCapped, 14);
  assert.equal(report.attempts[0].textMetrics.messageText.maxLengthCapped, 14);

  const serialized = JSON.stringify(report);
  for (const canary of [
    "URL_CANARY",
    "HEADER_CANARY",
    "REQUEST_BODY_CANARY",
    "PRIVATE_WORKFLOW",
    "PRIVATE_ANSWER"
  ]) {
    assert.equal(serialized.includes(canary), false);
  }
});

test("detects bounded indexed-message conflicts without exposing indexes or digests", async () => {
  const events = [
    { event: "message", data: { text: "INDEX_TEXT_A_CANARY", index: 7 } },
    { event: "message", data: { text: "INDEX_TEXT_A_CANARY", index: 7 } },
    { event: "message", data: { text: "INDEX_TEXT_B_CANARY", index: 7 } },
    { event: "message", data: { text: null, index: -10 } },
    { event: "message", data: { text: "INVALID_NEGATIVE_CANARY", index: -1 } },
    { event: "message", data: { text: "INVALID_FRACTION_CANARY", index: 1.5 } },
    { event: "message", data: { text: "INVALID_STRING_CANARY", index: "1" } },
    { event: "message", data: { text: "MISSING_INDEX_CANARY" } },
    { event: "message", data: { text: "\ud800", index: 8 } },
    { event: "message", data: { text: "\ufffd", index: 8 } }
  ];
  const body = encoder.encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
  );
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [body] })
  );
  const response = await diagnostic.fetch("ignored", {});
  response.headers.get("content-type");
  await consumeReader(response);

  const report = diagnostic.finish();
  assert.deepEqual(report.attempts[0].indexedMessages, {
    coverage: "complete",
    trackedIndexCountCapped: 2,
    validIndexOccurrenceCountCapped: 5,
    validIndexOccurrenceCountSaturated: false,
    invalidIndexCountCapped: 3,
    invalidIndexCountSaturated: false,
    missingIndexCountCapped: 1,
    missingIndexCountSaturated: false,
    conflictCountCapped: 2,
    conflictCountSaturated: false,
    conflictObserved: true
  });
  const serialized = JSON.stringify(report);
  for (const canary of [
    "INDEX_TEXT_A_CANARY",
    "INDEX_TEXT_B_CANARY",
    "INVALID_NEGATIVE_CANARY",
    "INVALID_FRACTION_CANARY",
    "INVALID_STRING_CANARY",
    "MISSING_INDEX_CANARY"
  ]) {
    assert.equal(serialized.includes(canary), false);
  }
  assert.equal(/\b[0-9a-f]{64}\b/i.test(serialized), false);
});

test("maps malicious event names and fields to bounded shapes", async () => {
  const maliciousName = "EVENT_NAME_CANARY";
  const maliciousStatus = "STATUS_CANARY";
  const maliciousMessage = "MESSAGE_CANARY";
  const payload = `{"event":"${maliciousName}","status":"${maliciousStatus}","topSecretKey":"TOP_SECRET_CANARY","__proto__":{"polluted":"PROTO_CANARY"},"constructor":"CONSTRUCTOR_CANARY","data":{"message":"${maliciousMessage}","unknownSecretKey":"DATA_SECRET_CANARY","__proto__":"DATA_PROTO_CANARY","constructor":"DATA_CONSTRUCTOR_CANARY"}}`;
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    Object.assign(
      createResponse({ chunks: [encoder.encode(`data: ${payload}\n\n`)] }),
      { statusText: "STATUS_TEXT_CANARY" }
    )
  );
  const response = await diagnostic.fetch("ignored", { secret: "INIT_CANARY" });
  assert.equal(response.statusText, "STATUS_TEXT_CANARY");
  response.headers.get("content-type");
  await consumeReader(response);

  const report = diagnostic.finish();
  const event = report.attempts[0].eventWindow.head[0];
  assert.equal(event.name, "other");
  assert.equal(event.top.status.type, "string");
  assert.equal(event.data.message.type, "string");
  assert.equal(event.topUnknownKeyCountCapped, 3);
  assert.equal(event.dataUnknownKeyCountCapped, 3);
  assert.equal(Object.prototype.polluted, undefined);
  const serialized = JSON.stringify(report);
  for (const canary of [
    maliciousName,
    maliciousStatus,
    maliciousMessage,
    "TOP_SECRET_CANARY",
    "DATA_SECRET_CANARY",
    "PROTO_CANARY",
    "CONSTRUCTOR_CANARY",
    "DATA_PROTO_CANARY",
    "DATA_CONSTRUCTOR_CANARY",
    "STATUS_TEXT_CANARY",
    "INIT_CANARY"
  ]) {
    assert.equal(serialized.includes(canary), false);
  }
});

test("rethrows the original fetch failure without error details", async () => {
  const failure = new Error("FETCH_ERROR_CANARY");
  failure.name = "FETCH_NAME_CANARY";
  const diagnostic = createStructuralDiagnosticFetch(async () => {
    throw failure;
  });

  await assert.rejects(
    diagnostic.fetch("URL_CANARY", { headers: { secret: "HEADER_CANARY" } }),
    (error) => error === failure
  );
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].fetchOutcome, "rejected");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("FETCH_ERROR_CANARY"), false);
  assert.equal(serialized.includes("FETCH_NAME_CANARY"), false);
  assert.equal(serialized.includes("URL_CANARY"), false);
  assert.equal(serialized.includes("HEADER_CANARY"), false);
});

test("rethrows the original stream failure without swallowing earlier chunks", async () => {
  const first = encoder.encode('data: {"event":"task_start"}\n\n');
  const failure = new Error("STREAM_ERROR_CANARY");
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [first], failure: { at: 1, error: failure } })
  );
  const response = await diagnostic.fetch("ignored", {});
  const reader = response.body.getReader();

  const firstResult = await reader.read();
  assert.equal(firstResult.value, first);
  await assert.rejects(reader.read(), (error) => error === failure);
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].bodyOutcome, "rejected");
  assert.equal(JSON.stringify(report).includes("STREAM_ERROR_CANARY"), false);
});

test("passes AbortSignal by identity without attaching request observers", async () => {
  const controller = new AbortController();
  const init = { signal: controller.signal };
  let passedInit;
  const diagnostic = createStructuralDiagnosticFetch(async (_url, value) => {
    passedInit = value;
    return createResponse();
  });

  const response = await diagnostic.fetch("ignored", init);
  await consumeReader(response);
  assert.equal(passedInit, init);
  assert.equal(passedInit.signal, controller.signal);
});

test("keeps bounded head and tail structure plus saturated text metrics for a 466KB stream", async () => {
  const messageText = `LARGE_BODY_CANARY_${"x".repeat(80)}`;
  const workflowAnswer = "FINAL_ANSWER_CANARY".repeat(32);
  const events = [
    { event: "task_start", data: {} },
    { event: "workflow_start", data: { workflow_name: "PRIVATE_WORKFLOW" } }
  ];
  for (let index = 0; index < 4_200; index += 1) {
    events.push({ event: "message", data: { text: messageText, index } });
  }
  events.push(
    { event: "message", data: { text: null } },
    { event: "workflow_end", data: { answer: workflowAnswer } },
    { event: "workflow_end", data: { answer: 42 } },
    { event: "error", data: { message: "ERROR_BODY_CANARY" } },
    { event: "task_end", data: {} },
    { event: "end", data: {} }
  );
  const large = encoder.encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
  );
  assert.equal(large.byteLength >= 466_000, true);
  assert.equal(large.byteLength < STRUCTURAL_DIAGNOSTIC_LIMITS.inspectedBytes, true);
  const chunks = [];
  for (let offset = 0; offset < large.byteLength; offset += 4096) {
    chunks.push(large.subarray(offset, Math.min(offset + 4096, large.byteLength)));
  }
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks })
  );
  const response = await diagnostic.fetch("ignored", {});
  const output = await consumeReader(response);
  assert.equal(output.length, chunks.length);
  for (let index = 0; index < chunks.length; index += 1) {
    assert.equal(output[index], chunks[index]);
  }

  const report = diagnostic.finish();
  const attempt = report.attempts[0];
  assert.equal(attempt.bodyOutcome, "complete");
  assert.equal(attempt.inspectedByteCount, large.byteLength);
  assert.equal(attempt.inspectionTruncated, false);
  assert.equal(attempt.eventWindow.head.length, STRUCTURAL_DIAGNOSTIC_LIMITS.eventWindow);
  assert.equal(attempt.eventWindow.tail.length, STRUCTURAL_DIAGNOSTIC_LIMITS.eventWindow);
  assert.equal(attempt.eventWindow.truncated, true);
  assert.deepEqual(
    attempt.eventWindow.head.slice(0, 2).map((event) => event.name),
    ["task_start", "workflow_start"]
  );
  assert.deepEqual(
    attempt.eventWindow.tail.slice(-5).map((event) => event.name),
    ["workflow_end", "workflow_end", "error", "task_end", "end"]
  );
  assert.equal(attempt.eventWindow.tail.at(-3).failureMarker, true);
  assert.equal(attempt.eventCountCapped, STRUCTURAL_DIAGNOSTIC_LIMITS.counters);
  assert.equal(attempt.eventCountOverLimit, true);
  assert.equal(attempt.eventCounts.message, STRUCTURAL_DIAGNOSTIC_LIMITS.counters);
  assert.equal(attempt.eventCounts.workflow_end, 2);
  assert.equal(attempt.eventCounts.error, 1);
  assert.equal(attempt.eventCounts.task_end, 1);
  assert.equal(attempt.eventCounts.end, 1);
  assert.equal(attempt.eventCounts.saturated, true);
  assert.deepEqual(attempt.textMetrics.messageText, {
    lengthUnit: "utf16_code_units",
    stringCountCapped: STRUCTURAL_DIAGNOSTIC_LIMITS.counters,
    stringCountSaturated: true,
    nonStringCountCapped: 1,
    nonStringCountSaturated: false,
    totalLengthCapped: STRUCTURAL_DIAGNOSTIC_LIMITS.textCharacters,
    totalLengthSaturated: true,
    maxLengthCapped: messageText.length,
    maxLengthSaturated: false
  });
  assert.deepEqual(attempt.textMetrics.workflowAnswer, {
    lengthUnit: "utf16_code_units",
    stringCountCapped: 1,
    stringCountSaturated: false,
    nonStringCountCapped: 1,
    nonStringCountSaturated: false,
    totalLengthCapped: workflowAnswer.length,
    totalLengthSaturated: false,
    maxLengthCapped: workflowAnswer.length,
    maxLengthSaturated: false
  });
  assert.deepEqual(attempt.indexedMessages, {
    coverage: "partial",
    trackedIndexCountCapped: STRUCTURAL_DIAGNOSTIC_LIMITS.indexedMessages,
    validIndexOccurrenceCountCapped: STRUCTURAL_DIAGNOSTIC_LIMITS.counters,
    validIndexOccurrenceCountSaturated: true,
    invalidIndexCountCapped: 0,
    invalidIndexCountSaturated: false,
    missingIndexCountCapped: 0,
    missingIndexCountSaturated: false,
    conflictCountCapped: 0,
    conflictCountSaturated: false,
    conflictObserved: false
  });
  assert.equal(JSON.stringify(report).includes("LARGE_BODY_CANARY"), false);
  assert.equal(JSON.stringify(report).includes("FINAL_ANSWER_CANARY"), false);
  assert.equal(JSON.stringify(report).includes("ERROR_BODY_CANARY"), false);
  assert.equal(JSON.stringify(report).includes("PRIVATE_WORKFLOW"), false);
  assert.equal(JSON.stringify(report).length < 150_000, true);
});

test("marks invalid UTF-8 and preserves its bytes", async () => {
  const bytes = Uint8Array.from([0xff, 0xfe, 0xfd]);
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [bytes] })
  );
  const response = await diagnostic.fetch("ignored", {});
  const output = await consumeReader(response);
  assert.equal(output[0], bytes);
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].utf8, "invalid");
  assert.equal(report.attempts[0].indexedMessages.coverage, "partial");
});

test("marks indexed-message coverage partial after an SSE JSON parse failure", async () => {
  const body = encoder.encode(
    'data: NOT_JSON_CANARY\n\ndata: {"event":"task_end","data":{}}\n\n'
  );
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [body] })
  );
  await consumeReader(await diagnostic.fetch("ignored", {}));
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].framing.jsonParseFailuresCapped, 1);
  assert.equal(report.attempts[0].indexedMessages.coverage, "partial");
  assert.equal(JSON.stringify(report).includes("NOT_JSON_CANARY"), false);
});

test("normalizes missing and foreign content types without retaining values", async () => {
  for (const [contentType, expected, canary] of [
    [null, "missing", null],
    ["application/CONTENT_TYPE_CANARY", "other", "CONTENT_TYPE_CANARY"]
  ]) {
    const diagnostic = createStructuralDiagnosticFetch(async () =>
      createResponse({ contentType })
    );
    const response = await diagnostic.fetch("ignored", {});
    assert.equal(response.headers.get("content-type"), contentType);
    await consumeReader(response);
    const report = diagnostic.finish();
    assert.equal(report.attempts[0].contentType, expected);
    assert.equal(report.attempts[0].eventInspection, "unconfirmed");
    assert.equal(report.attempts[0].indexedMessages.coverage, "partial");
    if (canary) {
      assert.equal(JSON.stringify(report).includes(canary), false);
    }
  }
});

test("does not claim complete coverage before confirming SSE content type", async () => {
  const canary = "UNCONFIRMED_SSE_BODY_CANARY";
  const body = encoder.encode(
    `data: {"event":"message","data":{"text":"${canary}","index":1}}\n\n`
  );
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [body] })
  );
  const response = await diagnostic.fetch("ignored", {});
  await consumeReader(response);

  const report = diagnostic.finish();
  assert.equal(report.attempts[0].contentType, "unread");
  assert.equal(report.attempts[0].eventInspection, "unconfirmed");
  assert.equal(report.attempts[0].indexedMessages.coverage, "partial");
  assert.equal(JSON.stringify(report).includes(canary), false);
});

test("keeps diagnostic parsing failures from changing response consumption", async () => {
  const malformed = encoder.encode(
    `data: {"event":"message","data":{"text":"${"x".repeat(
      STRUCTURAL_DIAGNOSTIC_LIMITS.eventPayloadCharacters + 100
    )}"}}\n\n`
  );
  const after = encoder.encode('data: {"event":"task_end"}\n\n');
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [malformed, after] })
  );
  const response = await diagnostic.fetch("ignored", {});
  const output = await consumeReader(response);
  assert.equal(output[0], malformed);
  assert.equal(output[1], after);
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].inspectionTruncated, true);
  assert.equal(report.attempts[0].indexedMessages.coverage, "partial");
});

test("preserves async iterator return behavior and chunk identity", async () => {
  const chunk = encoder.encode('data: {"event":"task_start"}\n\n');
  const returned = { done: true, value: "RETURN_VALUE_CANARY" };
  let nextCalls = 0;
  let returnCalls = 0;
  const body = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          nextCalls += 1;
          return { done: false, value: chunk };
        },
        async return() {
          returnCalls += 1;
          return returned;
        }
      };
    }
  };
  const diagnostic = createStructuralDiagnosticFetch(async () => ({
    status: 200,
    headers: { get: () => "text/event-stream" },
    body
  }));
  const response = await diagnostic.fetch("ignored", {});
  const iterator = response.body[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.value, chunk);
  const returnResult = await iterator.return("RELEASE_REASON_CANARY");
  assert.equal(returnResult, returned);
  assert.equal(nextCalls, 1);
  assert.equal(returnCalls, 1);
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].bodyOutcome, "released");
  assert.equal(JSON.stringify(report).includes("RETURN_VALUE_CANARY"), false);
  assert.equal(JSON.stringify(report).includes("RELEASE_REASON_CANARY"), false);
});

test("does not add iterator release methods that the source lacks", async () => {
  const iterator = {
    async next() {
      return { done: true, value: undefined };
    }
  };
  const diagnostic = createStructuralDiagnosticFetch(async () => ({
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: {
      [Symbol.asyncIterator]() {
        return iterator;
      }
    }
  }));
  const response = await diagnostic.fetch("ignored", {});
  const wrapped = response.body[Symbol.asyncIterator]();
  assert.equal(Object.hasOwn(wrapped, "return"), false);
  assert.equal(Object.hasOwn(wrapped, "throw"), false);
  assert.deepEqual(await wrapped.next(), { done: true, value: undefined });
});

test("supports native Response, Headers, ReadableStream, and reader getters", async () => {
  const first = encoder.encode('data: {"event":"workflow_start"}\n\n');
  const second = encoder.encode('data: {"event":"task_end"}\n\n');
  const source = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      }
    }),
    {
      status: 201,
      statusText: "NATIVE_STATUS_TEXT_CANARY",
      headers: new Headers({
        "content-type": "text/event-stream; charset=utf-8"
      })
    }
  );
  const diagnostic = createStructuralDiagnosticFetch(async () => source);
  const response = await diagnostic.fetch("ignored", {});

  assert.equal(response.status, 201);
  assert.equal(response.ok, true);
  assert.equal(response.statusText, "NATIVE_STATUS_TEXT_CANARY");
  assert.equal(response.headers instanceof Headers, true);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.body.locked, false);
  const reader = response.body.getReader();
  assert.equal(response.body.locked, true);
  assert.equal(reader.closed instanceof Promise, true);
  const chunks = [];
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
  }
  assert.equal(chunks[0], first);
  assert.equal(chunks[1], second);
  reader.releaseLock();

  const report = diagnostic.finish();
  assert.equal(report.attempts[0].status, 201);
  assert.equal(report.attempts[0].contentType, "text/event-stream");
  assert.deepEqual(
    windowEvents(report.attempts[0]).map((event) => event.name),
    ["workflow_start", "task_end"]
  );
  assert.equal(JSON.stringify(report).includes("NATIVE_STATUS_TEXT_CANARY"), false);
});

test("observes the valid prefix of the chunk that crosses the inspection cap", async () => {
  const prefixLength = STRUCTURAL_DIAGNOSTIC_LIMITS.inspectedBytes - 80;
  const filler = encoder.encode(":x\n".repeat(Math.floor(prefixLength / 3)));
  const terminal = encoder.encode('data: {"event":"task_end"}\n\n');
  const trailing = encoder.encode("TRAILING_CONTENT_CANARY".repeat(20));
  const crossingChunk = new Uint8Array(terminal.byteLength + trailing.byteLength);
  crossingChunk.set(terminal, 0);
  crossingChunk.set(trailing, terminal.byteLength);
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [filler, crossingChunk] })
  );
  const response = await diagnostic.fetch("ignored", {});
  const output = await consumeReader(response);
  assert.equal(output[0], filler);
  assert.equal(output[1], crossingChunk);

  const report = diagnostic.finish();
  assert.equal(report.attempts[0].inspectionTruncated, true);
  assert.equal(
    windowEvents(report.attempts[0]).some((event) => event.name === "task_end"),
    true
  );
  assert.equal(JSON.stringify(report).includes("TRAILING_CONTENT_CANARY"), false);
});

test("flushes a final decoder code point and unterminated data line", async () => {
  const bytes = encoder.encode('data: {"event":"task_end","data":{"text":"尾"}}');
  const split = bytes.byteLength - 1;
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [bytes.subarray(0, split), bytes.subarray(split)] })
  );
  const response = await diagnostic.fetch("ignored", {});
  await consumeReader(response);
  const report = diagnostic.finish();
  assert.deepEqual(
    windowEvents(report.attempts[0]).map((event) => event.name),
    ["task_end"]
  );
});

test("does not call an inspection-cap split UTF-8 code point invalid", async () => {
  const filler = encoder.encode(
    ":\n".repeat((STRUCTURAL_DIAGNOSTIC_LIMITS.inspectedBytes - 2) / 2)
  );
  const crossingChunk = encoder.encode("尾");
  const diagnostic = createStructuralDiagnosticFetch(async () =>
    createResponse({ chunks: [filler, crossingChunk] })
  );
  const response = await diagnostic.fetch("ignored", {});
  const output = await consumeReader(response);
  assert.equal(output[0], filler);
  assert.equal(output[1], crossingChunk);

  const report = diagnostic.finish();
  assert.equal(report.attempts[0].inspectionTruncated, true);
  assert.equal(report.attempts[0].utf8, "unknown");
  assert.equal(report.attempts[0].indexedMessages.coverage, "partial");
  assert.equal(report.attempts[0].bodyOutcome, "complete");
  assert.equal(
    report.attempts[0].byteCountCapped,
    filler.byteLength + crossingChunk.byteLength
  );
});

test("marks the decoded-text fallback byte count unavailable without retaining text", async () => {
  const text = "DECODED_TEXT_CANARY";
  const diagnostic = createStructuralDiagnosticFetch(async () => ({
    status: 200,
    headers: { get: () => "text/event-stream" },
    text: async () => text
  }));
  const response = await diagnostic.fetch("ignored", {});
  assert.equal(await response.text(), text);
  const report = diagnostic.finish();
  assert.equal(report.attempts[0].bodyKind, "text");
  assert.equal(report.attempts[0].byteCountMode, "unavailable");
  assert.equal(report.attempts[0].byteCountCapped, 0);
  assert.equal(report.attempts[0].inspectedByteCount, 0);
  assert.equal(report.attempts[0].diagnosticOutcome, "decoded_text_unobserved");
  assert.equal(JSON.stringify(report).includes(text), false);
});
