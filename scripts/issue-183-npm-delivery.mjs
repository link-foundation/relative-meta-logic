import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPublished, LIBRARY_DIR, readLibraryManifest } from './npm-release.mjs';

export function checkMetaLanguageNpmDelivery({ event = process.env.GITHUB_EVENT_NAME, lookup = isPublished } = {}) {
  const { name, version } = readLibraryManifest(path.join(LIBRARY_DIR, 'vendor/meta-language/js'));
  const spec = `${name}@${version}`;
  if (lookup(name, version)) {
    return { passed: true, message: `${spec} is available on npm.` };
  }

  const action = `An npm maintainer of ${name} must publish the JavaScript package from the official link-foundation/meta-language v${version} release to registry.npmjs.org, then rerun this workflow.`;
  if (event === 'pull_request') {
    return { passed: true, message: `Skipping the published-package availability requirement for this PR because ${spec} is absent from npm. ${action} The complete-delivery gate still checks R51 and R133.` };
  }
  return { passed: false, message: `${spec} is absent from npm. ${action}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { passed, message } = checkMetaLanguageNpmDelivery();
  if (passed) console.log(message);
  else {
    console.error(`::error title=Upstream npm publication required::${message}`);
    process.exitCode = 1;
  }
}
