import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const workflow=await readFile(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
test('workflow gates deployment on tests and explicit opt-in instead of deploying every main push',()=>{
  assert.match(workflow,/needs: test/);
  assert.match(workflow,/if: github.event_name == 'workflow_dispatch' && inputs.deploy/);
  assert.match(workflow,/default: false/);
  assert.doesNotMatch(workflow,/continue-on-error:\s*true/);
});
test('workflow uploads only to incoming and uses the staged deploy entry point',()=>{
  const targets=[...workflow.matchAll(/target:\s*"([^"\n]+)"/g)].map((m)=>m[1]);
  assert.equal(targets.length,1);
  assert.ok(targets.every((path)=>path.startsWith('/opt/shishka-incoming/')));
  assert.match(workflow,/node \/opt\/shishka-ops\/deploy.mjs/);
  assert.doesNotMatch(workflow,/script:\s*systemctl restart/);
  assert.match(workflow,/sha256sum --check release.tar.gz.sha256/);
});
