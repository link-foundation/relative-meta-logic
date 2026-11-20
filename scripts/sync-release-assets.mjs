import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const releaseAssets = {
  js: ['horn-link-substitution.lino', 'horn-rml-elaboration.lino'],
  rust: ['fixed-point-source.lino', 'fixed-point.ski'],
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [directory, assets] of Object.entries(releaseAssets)) {
    for (const asset of assets) {
      const target = new URL(`../${directory}/src/meta-theory/${asset}`, import.meta.url);
      mkdirSync(dirname(fileURLToPath(target)), { recursive: true });
      copyFileSync(new URL(`../lib/meta-theory/${asset}`, import.meta.url), target);
    }
  }
}
