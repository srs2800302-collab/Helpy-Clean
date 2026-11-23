import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
function runtimeOffenders(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ES2023, true);
  const offenders = [];
  function visit(node) {
    const memberName = node.parent && ((ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
      ((ts.isMethodSignature(node.parent) || ts.isMethodDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node));
    if (ts.isIdentifier(node) && !memberName && ['process', 'Buffer', 'fetch', 'setTimeout', 'setInterval', 'D1Database', 'ExecutionContext'].includes(node.text)) offenders.push(node.text);
    if (ts.isStringLiteral(node) && /^(node:|@cloudflare|wrangler)/.test(node.text)) offenders.push(node.text);
    if (ts.isNewExpression(node) && node.expression.getText(tree) === 'Date') offenders.push('new Date');
    ts.forEachChild(node, visit);
  }
  visit(tree); return offenders;
}
test('BND F2 internal layers compile without Node types, DOM, runtime globals or external adapters', async () => {
  assert.deepEqual(runtimeOffenders('negative.ts', "import fs from 'node:fs'; process.exit(); fetch('x'); new Date();"), ['node:fs', 'process', 'fetch', 'new Date']);
  assert.deepEqual(runtimeOffenders('comment.ts', '// process restart is a persistence guarantee'), []);
  assert.deepEqual(runtimeOffenders('port.ts', 'interface Images { process(): void } const port = { process() {} }; port.process();'), []);
  const files = [];
  for (const layer of ['domain', 'application']) {
    const directory = path.join(root, 'apps/backend/src', layer);
    for (const entry of await readdir(directory)) if (entry.endsWith('.ts')) {
      const file = path.join(directory, entry); files.push(file); const source = await readFile(file, 'utf8');
      assert.deepEqual(runtimeOffenders(file, source), [], file);
    }
  }
  const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, lib: ['lib.es2023.d.ts'], types: [], strict: true,
    noEmit: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, skipLibCheck: false });
  const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  const noNode = ts.createProgram({ rootNames: files, options: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [], noEmit: true } });
  assert.ok(noNode.getSourceFiles().every(file => !file.fileName.includes('@types/node')));
});
test('BND CodeReview is not a product dependency or CI prerequisite; F1 contracts and adapters remain separate', async () => {
  for (const file of ['package.json', 'apps/backend/package.json', 'packages/contracts/package.json', '.github/workflows/verify.yml']) {
    assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), /code-review|CodeReview/);
  }
});
