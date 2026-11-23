export function pythonOnlyReview(review,mode) {
  const component=mode==='lint'?'ruff':mode==='typecheck'?'basedpyright':null;
  const unsupported=new Set(['UNSUPPORTED_TYPECHECK_SCOPE: no Python sources','UNSUPPORTED_TYPECHECK_LANGUAGE: .mjs']);
  return component!==null&&review.status==='FAIL'&&review.components?.length===1&&
    review.components[0].name===component&&review.components[0].status==='blocked'&&
    review.components[0].truncated===false&&unsupported.has(review.components[0].detail)&&
    review.findings?.length===0&&review.summary?.finding_count===0&&review.summary.error_count===0&&
    review.summary.warning_count===0&&review.summary.semantic_review_targets===0&&review.summary.truncated===false;
}
