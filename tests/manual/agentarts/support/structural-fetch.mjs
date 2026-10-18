import { createHash } from "node:crypto";

const EVENT_NAMES = Object.freeze([
  "task_start",
  "workflow_start",
  "message",
  "workflow_end",
  "task_end",
  "end",
  "error",
  "status"
]);
const EVENT_COUNT_NAMES = Object.freeze([...EVENT_NAMES, "other"]);
const KNOWN_EVENT_NAMES = new Set(EVENT_NAMES);

const FAILURE_MARKERS = new Set([
  "error",
  "failed",
  "failure",
  "cancelled",
  "canceled"
]);

const DATA_FIELDS = [
  "text",
  "answer",
  "index",
  "workflow_name",
  "event",
  "type",
  "status",
  "error_code",
  "code",
  "message"
];

const TOP_LEVEL_FIELDS = ["event", "type", "status", "data"];

export const STRUCTURAL_DIAGNOSTIC_LIMITS = Object.freeze({
  inspectedBytes: 1024 * 1024,
  reportedBytes: 1024 * 1024 + 1,
  lineCharacters: 32 * 1024,
  eventPayloadCharacters: 64 * 1024,
  eventWindow: 32,
  counters: 4097,
  stringLength: 16 * 1024 + 1,
  textCharacters: 16_001,
  indexedMessages: 1024,
  attempts: 4
});

function incrementCapped(value) {
  return Math.min(value + 1, STRUCTURAL_DIAGNOSTIC_LIMITS.counters);
}

function addCapped(value, amount, limit) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return value;
  }
  return Math.min(value + amount, limit);
}

function valueType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "object":
      return typeof value;
    case "undefined":
      return "missing";
    default:
      return "other";
  }
}

function fieldShape(owner, field) {
  if (!owner || typeof owner !== "object" || !Object.hasOwn(owner, field)) {
    return { presence: false, type: "missing" };
  }

  const value = owner[field];
  const shape = { presence: true, type: valueType(value) };
  if (typeof value === "string") {
    shape.lengthCapped = Math.min(
      value.length,
      STRUCTURAL_DIAGNOSTIC_LIMITS.stringLength
    );
    shape.overLimit = value.length > STRUCTURAL_DIAGNOSTIC_LIMITS.stringLength;
  }
  if (field === "index") {
    shape.validNonNegativeInteger =
      Number.isSafeInteger(value) && value >= 0;
  }
  return shape;
}

function countUnknownKeys(value, knownFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }
  const known = new Set(knownFields);
  let count = 0;
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      count = incrementCapped(count);
    }
  }
  return count;
}

function hasFailureMarker(value) {
  if (typeof value !== "string") {
    return false;
  }
  return FAILURE_MARKERS.has(value.trim().toLowerCase());
}

function sanitizeEvent(value) {
  const objectValue = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
  const eventCandidate = typeof objectValue?.event === "string"
    ? objectValue.event
    : typeof objectValue?.type === "string"
      ? objectValue.type
      : "";
  const eventName = KNOWN_EVENT_NAMES.has(eventCandidate)
    ? eventCandidate
    : "other";

  const summary = {
    name: eventName,
    rootType: valueType(value),
    failureMarker:
      hasFailureMarker(objectValue?.event) ||
      hasFailureMarker(objectValue?.type) ||
      hasFailureMarker(objectValue?.status),
    top: {},
    topUnknownKeyCountCapped: countUnknownKeys(
      objectValue,
      [...TOP_LEVEL_FIELDS, "error_code", "code", "message"]
    ),
    dataType: valueType(objectValue?.data),
    data: {},
    dataUnknownKeyCountCapped: countUnknownKeys(objectValue?.data, DATA_FIELDS)
  };

  for (const field of TOP_LEVEL_FIELDS) {
    summary.top[field] = fieldShape(objectValue, field);
  }
  for (const field of DATA_FIELDS) {
    summary.data[field] = fieldShape(objectValue?.data, field);
  }
  summary.failureMarker =
    summary.failureMarker ||
    hasFailureMarker(objectValue?.data?.event) ||
    hasFailureMarker(objectValue?.data?.type) ||
    hasFailureMarker(objectValue?.data?.status);

  return summary;
}

function createEventCounts() {
  return Object.fromEntries(EVENT_COUNT_NAMES.map((name) => [name, 0]));
}

function createTextMetric() {
  return {
    lengthUnit: "utf16_code_units",
    stringCountCapped: 0,
    stringCountSaturated: false,
    nonStringCountCapped: 0,
    nonStringCountSaturated: false,
    totalLengthCapped: 0,
    totalLengthSaturated: false,
    maxLengthCapped: 0,
    maxLengthSaturated: false
  };
}

function incrementMetric(metric, field, saturatedField) {
  metric[field] = incrementCapped(metric[field]);
  if (metric[field] >= STRUCTURAL_DIAGNOSTIC_LIMITS.counters) {
    metric[saturatedField] = true;
  }
}

function observeTextField(metric, owner, field) {
  if (!owner || typeof owner !== "object" || !Object.hasOwn(owner, field)) {
    return;
  }
  const value = owner[field];
  if (typeof value !== "string") {
    incrementMetric(metric, "nonStringCountCapped", "nonStringCountSaturated");
    return;
  }

  incrementMetric(metric, "stringCountCapped", "stringCountSaturated");
  metric.totalLengthCapped = addCapped(
    metric.totalLengthCapped,
    value.length,
    STRUCTURAL_DIAGNOSTIC_LIMITS.textCharacters
  );
  if (metric.totalLengthCapped >= STRUCTURAL_DIAGNOSTIC_LIMITS.textCharacters) {
    metric.totalLengthSaturated = true;
  }
  metric.maxLengthCapped = Math.max(
    metric.maxLengthCapped,
    Math.min(value.length, STRUCTURAL_DIAGNOSTIC_LIMITS.stringLength)
  );
  if (value.length >= STRUCTURAL_DIAGNOSTIC_LIMITS.stringLength) {
    metric.maxLengthSaturated = true;
  }
}

function createIndexedMessageMetric() {
  return {
    coverage: "complete",
    trackedIndexCountCapped: 0,
    validIndexOccurrenceCountCapped: 0,
    validIndexOccurrenceCountSaturated: false,
    invalidIndexCountCapped: 0,
    invalidIndexCountSaturated: false,
    missingIndexCountCapped: 0,
    missingIndexCountSaturated: false,
    conflictCountCapped: 0,
    conflictCountSaturated: false,
    conflictObserved: false
  };
}

function createEventAnalyzer(record) {
  let decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "";
  let lineOverflow = false;
  let payload = "";
  let payloadOverflow = false;
  let payloadLineCount = 0;
  let finalized = false;
  const indexedMessages = new Map();

  function observeIndexedMessage(data) {
    if (!data || typeof data !== "object" || typeof data.text !== "string") {
      return;
    }
    if (!Object.hasOwn(data, "index")) {
      incrementMetric(
        record.indexedMessages,
        "missingIndexCountCapped",
        "missingIndexCountSaturated"
      );
      return;
    }
    const index = data.index;
    if (!Number.isSafeInteger(index) || index < 0) {
      incrementMetric(
        record.indexedMessages,
        "invalidIndexCountCapped",
        "invalidIndexCountSaturated"
      );
      return;
    }
    incrementMetric(
      record.indexedMessages,
      "validIndexOccurrenceCountCapped",
      "validIndexOccurrenceCountSaturated"
    );

    const previous = indexedMessages.get(index);
    const digest = createHash("sha256")
      .update(data.text, "utf16le")
      .digest("hex");
    if (previous !== undefined) {
      if (previous.length !== data.text.length || previous.digest !== digest) {
        record.indexedMessages.conflictObserved = true;
        incrementMetric(
          record.indexedMessages,
          "conflictCountCapped",
          "conflictCountSaturated"
        );
      }
      return;
    }
    if (indexedMessages.size >= STRUCTURAL_DIAGNOSTIC_LIMITS.indexedMessages) {
      record.indexedMessages.coverage = "partial";
      return;
    }
    indexedMessages.set(index, { length: data.text.length, digest });
    record.indexedMessages.trackedIndexCountCapped = indexedMessages.size;
  }

  function addEvent(value) {
    // The public parser accepts event arrays; this observer does not inspect their members.
    if (Array.isArray(value)) record.indexedMessages.coverage = "partial";
    const summary = sanitizeEvent(value);
    record.eventCountCapped = incrementCapped(record.eventCountCapped);
    if (record.eventCountCapped >= STRUCTURAL_DIAGNOSTIC_LIMITS.counters) {
      record.eventCountOverLimit = true;
    }
    record.eventCounts[summary.name] = incrementCapped(
      record.eventCounts[summary.name]
    );
    if (record.eventCounts[summary.name] >= STRUCTURAL_DIAGNOSTIC_LIMITS.counters) {
      record.eventCounts.saturated = true;
    }

    const objectValue = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
    if (summary.name === "message") {
      observeTextField(record.textMetrics.messageText, objectValue?.data, "text");
      observeIndexedMessage(objectValue?.data);
    } else if (summary.name === "workflow_end") {
      observeTextField(record.textMetrics.workflowAnswer, objectValue?.data, "answer");
    }

    if (record.eventWindow.head.length < STRUCTURAL_DIAGNOSTIC_LIMITS.eventWindow) {
      record.eventWindow.head.push(summary);
      return;
    }
    if (record.eventWindow.tail.length >= STRUCTURAL_DIAGNOSTIC_LIMITS.eventWindow) {
      record.eventWindow.tail.shift();
      record.eventWindow.truncated = true;
    }
    record.eventWindow.tail.push(summary);
  }

  function parseCandidate(candidate) {
    record.framing.jsonCandidatesCapped = incrementCapped(
      record.framing.jsonCandidatesCapped
    );
    try {
      addEvent(JSON.parse(candidate));
      return true;
    } catch {
      record.framing.jsonParseFailuresCapped = incrementCapped(
        record.framing.jsonParseFailuresCapped
      );
      return false;
    }
  }

  function resetPayload() {
    payload = "";
    payloadOverflow = false;
    payloadLineCount = 0;
  }

  function flushPayload() {
    if (payloadLineCount === 0) {
      return;
    }
    if (payloadOverflow) {
      record.inspectionTruncated = true;
      record.framing.truncatedPayloadsCapped = incrementCapped(
        record.framing.truncatedPayloadsCapped
      );
    } else if (payload === "[DONE]") {
      record.framing.doneMarkersCapped = incrementCapped(
        record.framing.doneMarkersCapped
      );
    } else {
      parseCandidate(payload);
    }
    resetPayload();
  }

  function appendPayload(value) {
    if (payloadLineCount > 0 && !payloadOverflow) {
      if (payload.length + 1 <= STRUCTURAL_DIAGNOSTIC_LIMITS.eventPayloadCharacters) {
        payload += "\n";
      } else {
        payloadOverflow = true;
      }
    }
    payloadLineCount = incrementCapped(payloadLineCount);
    if (payloadOverflow) {
      return;
    }
    const remaining =
      STRUCTURAL_DIAGNOSTIC_LIMITS.eventPayloadCharacters - payload.length;
    if (value.length <= remaining) {
      payload += value;
    } else {
      payload += value.slice(0, remaining);
      payloadOverflow = true;
    }
  }

  function handleLine(rawLine) {
    record.framing.linesCapped = incrementCapped(record.framing.linesCapped);
    const current = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (lineOverflow) {
      record.inspectionTruncated = true;
      record.framing.oversizedLinesCapped = incrementCapped(
        record.framing.oversizedLinesCapped
      );
      lineOverflow = false;
      if (payloadLineCount > 0) {
        payloadOverflow = true;
      }
      flushPayload();
      return;
    }
    if (current === "") {
      record.framing.blankLinesCapped = incrementCapped(
        record.framing.blankLinesCapped
      );
      flushPayload();
      return;
    }
    if (current.startsWith(":")) {
      record.framing.commentLinesCapped = incrementCapped(
        record.framing.commentLinesCapped
      );
      return;
    }
    if (!current.startsWith("data:")) {
      record.framing.otherLinesCapped = incrementCapped(
        record.framing.otherLinesCapped
      );
      return;
    }

    record.framing.dataLinesCapped = incrementCapped(
      record.framing.dataLinesCapped
    );
    const data = current.slice(5).replace(/^ /, "");
    if (data === "[DONE]") {
      flushPayload();
      record.framing.doneMarkersCapped = incrementCapped(
        record.framing.doneMarkersCapped
      );
      return;
    }

    // AgentArts has emitted both standard SSE blocks and one-JSON-per-data-line
    // streams. A complete single-line object is recorded immediately; otherwise
    // a bounded block is retained until the next blank line.
    try {
      const parsed = JSON.parse(data);
      flushPayload();
      record.framing.jsonCandidatesCapped = incrementCapped(
        record.framing.jsonCandidatesCapped
      );
      addEvent(parsed);
    } catch {
      appendPayload(data);
    }
  }

  function observeText(text) {
    if (finalized || record.inspectionTruncated) {
      return;
    }
    for (const character of text) {
      if (character === "\n") {
        handleLine(line);
        line = "";
        continue;
      }
      if (line.length < STRUCTURAL_DIAGNOSTIC_LIMITS.lineCharacters) {
        line += character;
      } else {
        lineOverflow = true;
      }
    }
  }

  function observeBytes(bytes) {
    if (finalized || record.inspectionTruncated || record.utf8 === "invalid") {
      return;
    }
    const remaining =
      STRUCTURAL_DIAGNOSTIC_LIMITS.inspectedBytes - record.inspectedByteCount;
    if (remaining <= 0) {
      record.inspectionTruncated = true;
      if (record.utf8 !== "invalid") {
        record.utf8 = "unknown";
      }
      return;
    }
    const inspected = bytes.byteLength <= remaining
      ? bytes
      : bytes.subarray(0, remaining);
    record.inspectedByteCount += inspected.byteLength;
    try {
      observeText(decoder.decode(inspected, { stream: true }));
      record.utf8 = "valid";
    } catch {
      record.utf8 = "invalid";
      decoder = null;
    }
    if (bytes.byteLength > remaining) {
      record.inspectionTruncated = true;
      if (record.utf8 !== "invalid") {
        record.utf8 = "unknown";
      }
    }
  }

  function finish() {
    if (finalized) {
      return;
    }
    if (record.inspectionTruncated || record.utf8 === "invalid") {
      decoder = null;
      line = "";
      resetPayload();
      finalized = true;
      return;
    }
    if (decoder && record.utf8 !== "invalid") {
      try {
        observeText(decoder.decode());
      } catch {
        record.utf8 = "invalid";
      }
    }
    if (line.length > 0 || lineOverflow) {
      handleLine(line);
      line = "";
    }
    flushPayload();
    finalized = true;
  }

  return { observeBytes, finish };
}

function createAttemptRecord() {
  const record = {
    fetchOutcome: "pending",
    status: "unread",
    contentType: "unread",
    bodyKind: "unread",
    bodyOutcome: "unread",
    byteCountCapped: 0,
    byteCountOverLimit: false,
    byteCountMode: "binary_chunks",
    chunkCountCapped: 0,
    chunkCountOverLimit: false,
    inspectedByteCount: 0,
    inspectionTruncated: false,
    utf8: "unknown",
    diagnosticOutcome: "ok",
    eventInspection: "unconfirmed",
    eventCountCapped: 0,
    eventCountOverLimit: false,
    eventCounts: {
      ...createEventCounts(),
      saturated: false
    },
    eventWindow: {
      head: [],
      tail: [],
      truncated: false
    },
    textMetrics: {
      messageText: createTextMetric(),
      workflowAnswer: createTextMetric()
    },
    indexedMessages: createIndexedMessageMetric(),
    framing: {
      linesCapped: 0,
      blankLinesCapped: 0,
      commentLinesCapped: 0,
      dataLinesCapped: 0,
      otherLinesCapped: 0,
      doneMarkersCapped: 0,
      jsonCandidatesCapped: 0,
      jsonParseFailuresCapped: 0,
      oversizedLinesCapped: 0,
      truncatedPayloadsCapped: 0
    }
  };
  return { record, analyzer: createEventAnalyzer(record) };
}

function observeChunk(attempt, chunk) {
  try {
    attempt.record.chunkCountCapped = incrementCapped(
      attempt.record.chunkCountCapped
    );
    if (attempt.record.chunkCountCapped >= STRUCTURAL_DIAGNOSTIC_LIMITS.counters) {
      attempt.record.chunkCountOverLimit = true;
    }
    if (!(chunk instanceof Uint8Array)) {
      attempt.record.diagnosticOutcome = "unsupported_chunk";
      attempt.record.byteCountMode = "unavailable";
      return;
    }
    attempt.record.byteCountCapped = addCapped(
      attempt.record.byteCountCapped,
      chunk.byteLength,
      STRUCTURAL_DIAGNOSTIC_LIMITS.reportedBytes
    );
    if (
      attempt.record.byteCountCapped >= STRUCTURAL_DIAGNOSTIC_LIMITS.reportedBytes
    ) {
      attempt.record.byteCountOverLimit = true;
    }
    attempt.analyzer.observeBytes(chunk);
  } catch {
    attempt.record.diagnosticOutcome = "internal_failure";
  }
}

function finishAttempt(attempt, outcome) {
  if (attempt.record.bodyOutcome === "unread") {
    attempt.record.bodyOutcome = outcome;
  } else if (outcome === "rejected") {
    attempt.record.bodyOutcome = "rejected";
  }
  try {
    attempt.analyzer.finish();
  } catch {
    attempt.record.diagnosticOutcome = "internal_failure";
  }
}

function classifyContentType(value) {
  if (value === null || value === undefined || value === "") {
    return "missing";
  }
  if (typeof value !== "string") {
    return "other";
  }
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  if (mediaType === "text/event-stream") {
    return "text/event-stream";
  }
  if (mediaType === "application/json") {
    return "application/json";
  }
  return "other";
}

function wrapHeaders(headers, attempt) {
  if (!headers || typeof headers.get !== "function") {
    return headers;
  }
  return new Proxy(headers, {
    get(target, property, receiver) {
      if (property === "get") {
        return (name) => {
          try {
            const value = target.get(name);
            if (typeof name === "string" && name.toLowerCase() === "content-type") {
              attempt.record.contentType = classifyContentType(value);
              attempt.record.eventInspection =
                attempt.record.contentType === "text/event-stream"
                  ? "sse_only"
                  : attempt.record.contentType === "application/json"
                    ? "json_unparsed"
                    : "unconfirmed";
            }
            return value;
          } catch (error) {
            if (typeof name === "string" && name.toLowerCase() === "content-type") {
              attempt.record.contentType = "unreadable";
              attempt.record.eventInspection = "unconfirmed";
            }
            throw error;
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function wrapReader(reader, attempt) {
  return new Proxy(reader, {
    get(target, property, receiver) {
      if (property === "read") {
        return async (...args) => {
          try {
            const result = await target.read(...args);
            if (result?.done) {
              finishAttempt(attempt, "complete");
            } else {
              observeChunk(attempt, result?.value);
            }
            return result;
          } catch (error) {
            finishAttempt(attempt, "rejected");
            throw error;
          }
        };
      }
      if (property === "cancel") {
        return async (...args) => {
          try {
            const result = await target.cancel(...args);
            finishAttempt(attempt, "cancelled");
            return result;
          } catch (error) {
            finishAttempt(attempt, "rejected");
            throw error;
          }
        };
      }
      if (property === "releaseLock") {
        return (...args) => target.releaseLock(...args);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function wrapAsyncIterator(iterator, attempt) {
  const wrapped = {
    async next(...args) {
      try {
        const result = await iterator.next(...args);
        if (result?.done) {
          finishAttempt(attempt, "complete");
        } else {
          observeChunk(attempt, result?.value);
        }
        return result;
      } catch (error) {
        finishAttempt(attempt, "rejected");
        throw error;
      }
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
  if (typeof iterator.return === "function") {
    wrapped.return = async (...args) => {
      try {
        const result = await iterator.return(...args);
        finishAttempt(attempt, "released");
        return result;
      } catch (error) {
        finishAttempt(attempt, "rejected");
        throw error;
      }
    };
  }
  if (typeof iterator.throw === "function") {
    wrapped.throw = async (...args) => {
      try {
        return await iterator.throw(...args);
      } catch (error) {
        finishAttempt(attempt, "rejected");
        throw error;
      }
    };
  }
  return wrapped;
}

function wrapBody(body, attempt) {
  if (body === null || body === undefined) {
    attempt.record.bodyKind = "null";
    return body;
  }
  if (typeof body.getReader === "function") {
    attempt.record.bodyKind = "reader";
    return new Proxy(body, {
      get(target, property, receiver) {
        if (property === "getReader") {
          return (...args) => wrapReader(target.getReader(...args), attempt);
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    attempt.record.bodyKind = "async_iterable";
    return new Proxy(body, {
      get(target, property, receiver) {
        if (property === Symbol.asyncIterator) {
          return (...args) =>
            wrapAsyncIterator(target[Symbol.asyncIterator](...args), attempt);
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  }
  attempt.record.bodyKind = "other";
  return body;
}

function wrapResponse(response, attempt) {
  const bodyCache = { initialized: false, value: undefined };
  const headersCache = { initialized: false, value: undefined };
  return new Proxy(response, {
    get(target, property, receiver) {
      if (property === "status") {
        try {
          const status = Reflect.get(target, property, target);
          attempt.record.status = Number.isInteger(status) ? status : "invalid";
          return status;
        } catch (error) {
          attempt.record.status = "unreadable";
          throw error;
        }
      }
      if (property === "headers") {
        if (!headersCache.initialized) {
          headersCache.initialized = true;
          headersCache.value = wrapHeaders(
            Reflect.get(target, property, target),
            attempt
          );
        }
        return headersCache.value;
      }
      if (property === "body") {
        if (!bodyCache.initialized) {
          bodyCache.initialized = true;
          bodyCache.value = wrapBody(
            Reflect.get(target, property, target),
            attempt
          );
        }
        return bodyCache.value;
      }
      if (property === "arrayBuffer" && typeof target.arrayBuffer === "function") {
        return async (...args) => {
          try {
            const value = await target.arrayBuffer(...args);
            attempt.record.bodyKind = "array_buffer";
            observeChunk(attempt, new Uint8Array(value));
            finishAttempt(attempt, "complete");
            return value;
          } catch (error) {
            finishAttempt(attempt, "rejected");
            throw error;
          }
        };
      }
      if (property === "text" && typeof target.text === "function") {
        return async (...args) => {
          try {
            const value = await target.text(...args);
            attempt.record.bodyKind = "text";
            attempt.record.byteCountMode = "unavailable";
            attempt.record.diagnosticOutcome = "decoded_text_unobserved";
            finishAttempt(attempt, "complete");
            return value;
          } catch (error) {
            finishAttempt(attempt, "rejected");
            throw error;
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function snapshotReport(attempts, callCount, attemptsOverLimit) {
  for (const { record } of attempts) {
    if (
      record.bodyOutcome !== "complete"
      || record.inspectionTruncated
      || record.utf8 === "invalid"
      || record.eventInspection !== "sse_only"
      || record.framing.jsonParseFailuresCapped > 0
      || record.diagnosticOutcome !== "ok"
    ) {
      record.indexedMessages.coverage = "partial";
    }
  }
  return {
    schemaVersion: 2,
    callCountCapped: Math.min(callCount, STRUCTURAL_DIAGNOSTIC_LIMITS.counters),
    callCountOverLimit: callCount >= STRUCTURAL_DIAGNOSTIC_LIMITS.counters,
    attemptsOverLimit,
    attempts: attempts.map(({ record }) => structuredClone(record))
  };
}

/**
 * Wrap a test-host fetch implementation with bounded structural telemetry.
 *
 * The wrapper deliberately does not inspect its URL or init arguments. It
 * records only allowlisted response structure and returns the original
 * response values/chunks/errors to the caller.
 */
export function createStructuralDiagnosticFetch(innerFetch) {
  if (typeof innerFetch !== "function") {
    throw new TypeError("innerFetch must be a function");
  }

  const attempts = [];
  let callCount = 0;
  let attemptsOverLimit = false;

  async function fetchWithDiagnostics(...args) {
    callCount += 1;
    const attempt = createAttemptRecord();
    if (attempts.length < STRUCTURAL_DIAGNOSTIC_LIMITS.attempts) {
      attempts.push(attempt);
    } else {
      attemptsOverLimit = true;
    }

    try {
      // Do not read, clone, normalize, log, or retain any request argument.
      const response = await innerFetch(...args);
      attempt.record.fetchOutcome = "response";
      return wrapResponse(response, attempt);
    } catch (error) {
      attempt.record.fetchOutcome = "rejected";
      throw error;
    }
  }

  return {
    fetch: fetchWithDiagnostics,
    finish() {
      for (const attempt of attempts) {
        if (attempt.record.bodyOutcome !== "unread") {
          finishAttempt(attempt, attempt.record.bodyOutcome);
        }
      }
      return snapshotReport(attempts, callCount, attemptsOverLimit);
    }
  };
}
