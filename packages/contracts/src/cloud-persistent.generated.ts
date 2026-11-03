// Generated from schema/cloud-persistent.json. Do not edit.

export type Id = string;
export type Time = string;
export type Digest = string;

export interface CloudPersistentContracts {
  command: {
    version: 1;
    commandId: Id;
    owner: Owner;
    deadline: Time;
    operation: "submit" | "control" | "readback" | "approval";
    submit?: {
      originTaskId: Id;
      originRuntimeId: Id;
      goal: string;
      goalDigest: Digest;
      taskDeadline: Time;
    };
    target?: Target;
    originCommandId?: Id;
    control?: {
      action: "pause" | "resume" | "cancel" | "enter_unattended" | "return";
      expectedControlRevision: number;
    };
    approval?: {
      approvalId: Id;
      expectedRevision: number;
      argumentsDigest: Digest;
      expiresAt: Time;
      decision: "allow_once" | "deny";
    };
  };
  reply: {
    version: 1;
    commandId: Id;
    owner: Owner;
    target: Target;
    controlRevision: number;
    task: {
      state:
        | "created"
        | "running"
        | "waiting_approval"
        | "waiting_reconciliation"
        | "cancelling"
        | "cancelled"
        | "failed"
        | "succeeded";
      revision: number;
      cancelRequested: boolean;
    };
    /**
     * @maxItems 50
     */
    approvals: {
      approvalId: Id;
      revision: number;
      action: string;
      argumentsDigest: Digest;
      arguments: {
        [k: string]: unknown;
      };
      expiresAt: Time;
      state: "pending" | "allowed" | "denied";
    }[];
    /**
     * @maxItems 100
     */
    evidenceRefs: Id[];
  };
}
export interface Owner {
  runtimeId: Id;
  hostId: Id;
  deploymentVersion: Id;
  contractRef: Id;
  contractVersion: Id;
}
export interface Target {
  taskId: Id;
  sessionId: Id;
}
