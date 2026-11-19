export const jobBundleIdentity:Readonly<{schemaVersion:1;component:'windows-job-process-host';runtimeVersion:'8.0.30'}>;
export function readSelfContainedHelperBundle(helperPath:string):{
  helperSha256:string;helperFilesSha256:Record<string,string>;
}|undefined;
