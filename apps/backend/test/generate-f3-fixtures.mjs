import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import ts from 'typescript';
const source=await readFile(new URL('./f2-operation-matrix.test.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('fixtures.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=tree.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&['A','cancellation','decision'].includes(d.name.text)));
const prepare=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='prepare');
if(declarations.length!==3||!prepare)throw new Error('Accepted F2 fixture structure changed');
const header=`// GENERATED from unchanged F2 operation preparation only; no test assertions are copied or weakened.\n// Source SHA256: ${createHash('sha256').update(source).digest('hex')}\n`;
const imports="import { harness } from './f2-harness.mjs';\nimport { catalog, scope } from './f2-fixtures.mjs';\nimport { query } from '../dist/application/queries.js';\nimport assert from 'node:assert/strict';\n";
await writeFile(new URL('./f3-operation-fixtures.generated.mjs',import.meta.url),header+imports+declarations.map(n=>n.getText(tree)).join('\n')+'\nexport '+prepare.getText(tree)+'\n');
