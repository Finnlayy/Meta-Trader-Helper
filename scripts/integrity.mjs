// integrity.mjs — reject forbidden source dependencies and text. Dependencies: Node.js.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const forbidden = /\b(?:mock|fake|dummy|simulated|lorem|placeholder)\b|(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*(?:^|\/)tests(?:\/|['"])/i;
let failed = false;
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (entry.isFile() && forbidden.test(await readFile(path, 'utf8'))) { console.error(`Integrity violation: ${path}`); failed = true; }
  }
}
await scan('src');
if (failed) process.exitCode = 1;
else console.log('Source integrity check passed.');
