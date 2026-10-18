import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = fileURLToPath(new URL('../../',import.meta.url));
export const policy = JSON.parse(await readFile(new URL('./design-policy.json',import.meta.url),'utf8'));
export const hashText = value => createHash('sha256').update(value.replace(/\r\n?/g,'\n'),'utf8').digest('hex');
export const manifestDigest = files => hashText(JSON.stringify(files));
export async function createManifest() {
  const files=[];
  for(const name of policy.requiredFiles) {
    const relative=path.posix.join(policy.designDirectory,name);
    files.push({path:relative,sha256:hashText(await readFile(path.join(root,relative),'utf8'))});
  }
  return {version:1,normalization:policy.normalization,files,digest:manifestDigest(files)};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const manifest=await createManifest();
  await writeFile(path.join(root,policy.designDirectory,'review-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({files:manifest.files.length,digest:manifest.digest}));
}
