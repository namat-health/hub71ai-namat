import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {QUESTIONNAIRE_REVISION} from './config.mjs';
const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('./source-revision.json', import.meta.url), 'utf8'));
// A changed legacy validator must never silently redefine a published revision.
// Deliberate revision changes require contract review, migration and fixtures.
export function assertSourceRevision() {
  if (manifest.questionnaireRevision !== QUESTIONNAIRE_REVISION) throw new Error('The source manifest revision does not match the API.');
  for (const [path, expected] of Object.entries(manifest.sources)) {
    const actual = createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
    if (actual !== expected) throw new Error('Shared questionnaire sources changed. Review and version the API contract before startup.');
  }
  return manifest.questionnaireRevision;
}
