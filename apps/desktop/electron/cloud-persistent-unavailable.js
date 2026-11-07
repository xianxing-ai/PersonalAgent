/**
 * Explicit unavailable cloud-persistent host for Competition proactive paths.
 * Never set available()===true without post-shutdown cloud Evidence (Owner rule).
 */
export function createUnavailableCloudPersistentHost(reason='cloud_persistent_post_shutdown_evidence_unavailable') {
  return {
    ref:'desktop:cloud-persistent:unavailable',
    available:()=>false,
    reason:()=>reason,
    assertAvailable(){
      const error=new Error(reason);
      error.code='UNSUPPORTED_CAPABILITY';
      throw error;
    },
  };
}
