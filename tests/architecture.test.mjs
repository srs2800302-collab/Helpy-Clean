import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');

async function sources(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `Source symlink: ${file}`);
    if (entry.isDirectory()) result.push(...await sources(file));
    else if (/\.(ts|dart)$/.test(file)) result.push(file);
  }
  return result;
}

function imports(file, source) {
  if (file.endsWith('.dart')) {
    return [...source.matchAll(/\b(?:import|export)\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  }
  const result = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier), `Nonliteral module: ${file}`);
      result.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
         (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0];
      assert.ok(argument && ts.isStringLiteral(argument), `Nonliteral module: ${file}`);
      result.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}

function allowed(file, dependency) {
  const relative = file.replaceAll('\\', '/');
  const resolved = dependency.startsWith('.') || relative.endsWith('.dart') && !dependency.includes(':')
    ? path.posix.normalize(path.posix.join(path.posix.dirname(relative), dependency))
    : dependency;
  if (relative.startsWith('packages/contracts/')) {
    return resolved.startsWith('packages/contracts/') || dependency.startsWith('dart:');
  }
  if (relative.includes('/domain/')) {
    const domainRoot = relative.slice(0, relative.indexOf('/domain/') + '/domain/'.length);
    return resolved.startsWith(domainRoot) || dependency.startsWith('dart:') ||
      dependency === 'package:fpdart/fpdart.dart';
  }
  if (relative.startsWith('apps/backend/src/application/')) {
    if (dependency === '@helpy/contracts') return true;
    return /^apps\/backend\/src\/(application|domain)\//.test(resolved);
  }
  if (relative.startsWith('apps/backend/src/transport/')) {
    return dependency === '@helpy/contracts' || /^apps\/backend\/src\/(transport|application)\//.test(resolved);
  }
  if (relative.startsWith('apps/backend/src/infrastructure/')) {
    return dependency.startsWith('node:') || dependency === '@helpy/contracts' || resolved.startsWith('apps/backend/src/');
  }
  if (relative.startsWith('apps/admin/src/application/')) {
    return dependency === '@helpy/contracts' || resolved.startsWith('apps/admin/src/application/');
  }
  if (relative.startsWith('apps/admin/src/presentation/')) {
    return dependency === '@helpy/contracts' || /^apps\/admin\/src\/(presentation|application)\//.test(resolved);
  }
  if (relative.includes('/features/') && relative.includes('/presentation/')) {
    return !/\b(data|infrastructure)\b/.test(dependency);
  }
  return !/cloudflare|wrangler|\/apps\//i.test(dependency);
}

test('boundary guard rejects representative inverted dependencies', () => {
  assert.equal(allowed('apps/backend/src/application/use-case.ts', 'node:http'), false);
  assert.equal(allowed('apps/backend/src/application/use-case.ts', '../infrastructure/db.js'), false);
  assert.equal(allowed('apps/backend/src/application/use-case.ts', './nested/../../infrastructure/db.js'), false);
  assert.equal(allowed('apps/backend/src/domain/entity.ts', '@cloudflare/workers-types'), false);
  assert.equal(allowed('apps/admin/src/presentation/page.ts', '../infrastructure/storage.ts'), false);
  assert.equal(allowed('apps/mobile/lib/features/example/domain/entity.dart', 'package:flutter/widgets.dart'), false);
  assert.equal(allowed('apps/mobile/lib/features/example/presentation/page.dart', '../data/repository.dart'), false);
  assert.equal(allowed('packages/contracts/src/index.ts', '../../../apps/backend/src/main.js'), false);
  assert.deepEqual(imports('example.ts', "import type { A } from './a.js'; export { B } from './b.js'; import('./c.js');"),
    ['./a.js', './b.js', './c.js']);
});

test('source dependency directions, portability and isolation hold', async () => {
  let count = 0;
  for (const directory of ['apps/backend/src', 'apps/admin/src', 'apps/mobile/lib', 'packages/contracts/src', 'packages/contracts/lib']) {
    for (const file of await sources(path.join(root, directory))) {
      count++;
      const relative = path.relative(root, file).replaceAll('\\', '/');
      const source = await readFile(file, 'utf8');
      assert.doesNotMatch(source, /\/media\/demo\/|\/home\/demo\/|Helpy-Audit|Helpy-F1|Repositories\/Helpy\//);
      for (const dependency of imports(file, source)) {
        assert.equal(allowed(relative, dependency), true, `${relative} -> ${dependency}`);
      }
    }
  }
  assert.ok(count >= 10, 'Architecture test must inspect actual source files');
  for (const directory of ['apps/backend/src/domain', 'apps/backend/src/application',
    'apps/backend/src/infrastructure', 'apps/backend/src/transport',
    'apps/mobile/lib/features/foundation/data', 'apps/mobile/lib/features/foundation/domain',
    'apps/mobile/lib/features/foundation/presentation']) {
    assert.ok((await readdir(path.join(root, directory))).length > 0, directory);
  }
});
