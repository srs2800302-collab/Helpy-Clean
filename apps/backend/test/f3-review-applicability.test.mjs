import assert from 'node:assert/strict';import test from 'node:test';
import {pythonOnlyReview} from './f3-review-applicability.mjs';
const unsupported=(mode,detail)=>({status:'FAIL',components:[{name:mode==='lint'?'ruff':'basedpyright',status:'blocked',detail,truncated:false}],findings:[],
 summary:{finding_count:0,error_count:0,warning_count:0,semantic_review_targets:0,truncated:false}});
for(const mode of ['lint','typecheck'])test(`F3 review applicability ${mode}: retain raw unsupported FAIL as N/A only`,()=>{
 for(const detail of ['UNSUPPORTED_TYPECHECK_SCOPE: no Python sources','UNSUPPORTED_TYPECHECK_LANGUAGE: .mjs'])assert.equal(pythonOnlyReview(unsupported(mode,detail),mode),true);
});
test('F3 review applicability never hides findings, errors, truncation, failed scanners or unsupported gate',()=>{
 const base=unsupported('lint','UNSUPPORTED_TYPECHECK_LANGUAGE: .mjs');
 for(const modify of [r=>r.findings.push({code:'security-finding'}),r=>r.summary.error_count++,r=>r.summary.warning_count++,r=>r.summary.finding_count++,
  r=>r.summary.semantic_review_targets++,r=>r.summary.truncated=true,r=>r.components[0].truncated=true,r=>r.components[0].status='error',
  r=>r.components[0].detail='SCANNER_FAILED',r=>r.components[0].name='semgrep',r=>r.components=[]]){
  const changed=structuredClone(base);modify(changed);assert.equal(pythonOnlyReview(changed,'lint'),false);
 }
 assert.equal(pythonOnlyReview(base,'gate'),false);assert.equal(pythonOnlyReview(base,'security'),false);assert.equal(pythonOnlyReview(base,'ast-scan'),false);
});
