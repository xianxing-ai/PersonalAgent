// Generated from schema/agentarts-transport.json. Do not edit.

export type AgentArtsTransportFrame =
  | {
      protocolVersion: "0.1.0";
      type: "ready";
      serverInstanceId: string;
      /**
       * @minItems 1
       * @maxItems 4
       */
      capabilities:
        | ["invoke" | "status" | "cancel" | "ephemeral-replay"]
        | ["invoke" | "status" | "cancel" | "ephemeral-replay", "invoke" | "status" | "cancel" | "ephemeral-replay"]
        | [
            "invoke" | "status" | "cancel" | "ephemeral-replay",
            "invoke" | "status" | "cancel" | "ephemeral-replay",
            "invoke" | "status" | "cancel" | "ephemeral-replay"
          ]
        | [
            "invoke" | "status" | "cancel" | "ephemeral-replay",
            "invoke" | "status" | "cancel" | "ephemeral-replay",
            "invoke" | "status" | "cancel" | "ephemeral-replay",
            "invoke" | "status" | "cancel" | "ephemeral-replay"
          ];
      restartRecovery: false;
      heartbeatMs: number;
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "invoke";
      deadline: string;
      payload:
        | {
            query: string;
          }
        | {
            inputs: {
              [k: string]: string;
            };
          };
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "cancel";
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "status";
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "accepted";
      serverInstanceId: string;
      deadline: string;
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "result";
      serverInstanceId: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      events: [
        (
          | {
              event: "message";
              data: {
                text: string;
              };
            }
          | {
              event: "task_end";
            }
          | {
              event: "end";
            }
        ),
        (
          | {
              event: "message";
              data: {
                text: string;
              };
            }
          | {
              event: "task_end";
            }
          | {
              event: "end";
            }
        ),
        (
          | {
              event: "message";
              data: {
                text: string;
              };
            }
          | {
              event: "task_end";
            }
          | {
              event: "end";
            }
        )
      ];
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "error";
      serverInstanceId: string;
      code:
        | "INVALID_ARGUMENT"
        | "UNAUTHORIZED"
        | "UNSUPPORTED_CAPABILITY"
        | "TIMEOUT"
        | "CANCELLED"
        | "RATE_LIMITED"
        | "EXTERNAL_FAILURE";
      accepted: boolean;
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "status";
      serverInstanceId: string;
      state: "running";
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "status";
      serverInstanceId: string;
      state: "completed";
      /**
       * @minItems 3
       * @maxItems 3
       */
      events: [
        (
          | {
              event: "message";
              data: {
                text: string;
              };
            }
          | {
              event: "task_end";
            }
          | {
              event: "end";
            }
        ),
        (
          | {
              event: "message";
              data: {
                text: string;
              };
            }
          | {
              event: "task_end";
            }
          | {
              event: "end";
            }
        ),
        (
          | {
              event: "message";
              data: {
                text: string;
              };
            }
          | {
              event: "task_end";
            }
          | {
              event: "end";
            }
        )
      ];
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "status";
      serverInstanceId: string;
      state: "failed";
      code:
        | "INVALID_ARGUMENT"
        | "UNAUTHORIZED"
        | "UNSUPPORTED_CAPABILITY"
        | "TIMEOUT"
        | "CANCELLED"
        | "RATE_LIMITED"
        | "EXTERNAL_FAILURE";
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "status";
      serverInstanceId: string;
      state: "cancelled";
      code:
        | "INVALID_ARGUMENT"
        | "UNAUTHORIZED"
        | "UNSUPPORTED_CAPABILITY"
        | "TIMEOUT"
        | "CANCELLED"
        | "RATE_LIMITED"
        | "EXTERNAL_FAILURE";
    }
  | {
      protocolVersion: "0.1.0";
      sessionId: string;
      requestId: string;
      idempotencyKey: string;
      payloadDigest: string;
      type: "status";
      serverInstanceId: string;
      state: "unknown";
    };
