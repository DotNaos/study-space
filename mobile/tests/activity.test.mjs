import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { positiveId, readerPath, resourceParams, submissionLabel, gradingLabel } from '../src/lib/activity.ts';
const resource={id:'a'.repeat(64),name:'Guide.pdf',previewKind:'pdf',mimeType:'application/pdf',previewUrl:`/api/providers/moodle/courses/7/modules/99/resources/${'a'.repeat(64)}/preview`};
test('native document routes require exact course/module/resource identities',()=>{
  assert.deepEqual(resourceParams(7,99,resource),{courseId:'7',moduleId:'99',resourceId:'a'.repeat(64)});
  assert.equal(resourceParams(0,99,resource),undefined);
  assert.equal(resourceParams(7,99,{...resource,id:'../wrong'}),undefined);
  for(const id of ['0','-1','1e2','001','3.5','9007199254740992'])assert.equal(positiveId(id),undefined);
  assert.equal(positiveId('7'),7);
});
test('embedded documents never accept external or mismatched preview URLs',()=>{
  assert.ok(readerPath(7,99,resource,'dark').startsWith('/reader.html?'));
  assert.equal(readerPath(8,99,resource,'dark'),undefined);
  assert.equal(readerPath(7,99,{...resource,previewUrl:'https://evil.test/document'},'dark'),undefined);
  assert.equal(readerPath(7,99,{...resource,previewKind:null},'dark'),undefined);
});
test('missing status stays unknown rather than claiming an unsubmitted task',()=>{
  assert.equal(submissionLabel(null),'Nicht verfügbar');
  assert.equal(submissionLabel('new'),'Noch nicht abgegeben');
  assert.equal(gradingLabel(null),'Nicht verfügbar');
});
test('course and activity links navigate internally instead of opening Safari',()=>{
  for(const file of ['course-screen.tsx','activity-screen.tsx','document-screen.tsx']){
    const source=readFileSync(new URL(`../src/components/${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/WebBrowser|Linking\.openURL|openBrowserAsync/);
  }
  assert.match(readFileSync(new URL('../src/components/document-screen.tsx',import.meta.url),'utf8'),/@dotnaos\/ui\/native\/document/);
});
