// Manual, read-only observation entry. Importing this module performs no I/O.
// The production implementation lives in the public package export; this file
// keeps the documented manual invocation path on the identical implementation.
export {readAgentArtsTrace, readAgentArtsTraceObservation, readAgentArtsRunLogs}
  from '@personal-agent/agentarts/observability/reader';
