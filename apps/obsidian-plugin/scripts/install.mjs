import {fileURLToPath} from 'node:url';
import {installPlugin, uninstallPlugin} from '../src/installation.mjs';

const args = process.argv.slice(2);
const removing = args[0] === '--uninstall';
if (removing) args.shift();
if (args.length !== 2 || args[0] !== '--vault') {
  console.error('Usage: node scripts/install.mjs [--uninstall] --vault <absolute Vault path>');
  process.exitCode = 1;
} else {
  try {
    const result = removing ? uninstallPlugin({vaultPath: args[1]}) : installPlugin({vaultPath: args[1],
      bundlePath: fileURLToPath(new URL('../dist/', import.meta.url))});
    console.log(JSON.stringify(result));
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
