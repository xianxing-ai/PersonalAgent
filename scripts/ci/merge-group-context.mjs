// Bind queue validation to GitHub's synthetic group commit, not any constituent PR.
export function validateMergeGroup({event,repository,ref,sha}) {
  const group=event?.merge_group;
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||event?.action!=='checks_requested'||event?.repository?.full_name!==repository||
    event?.pull_request||group?.base_ref!=='refs/heads/main'||
    !/^[0-9a-f]{40}$/i.test(group?.base_sha??'')||
    !/^[0-9a-f]{40}$/i.test(group?.head_sha??'')||group.head_sha!==sha||
    typeof group.head_ref!=='string'||group.head_ref!==ref||
    !/^refs\/heads\/gh-readonly-queue\/main\/[^\s~^:?*\[\\]+$/.test(ref)) {
    throw Error('Invalid merge group context');
  }
  return group.head_sha.toLowerCase();
}
