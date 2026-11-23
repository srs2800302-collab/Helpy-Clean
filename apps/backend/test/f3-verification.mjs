import {execFileSync,spawnSync} from 'node:child_process';import {readFile,writeFile,mkdir,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const phase=process.argv[2]??'regression';if(!['regression','self-acceptance','end-to-end'].includes(phase))throw new Error('Unknown verification phase');
const delivery=process.env.F3_DELIVERY_DIR??'docs/f3';
if(!['docs/f3','docs/f3r1','docs/f3r94'].includes(delivery))throw new Error('Unsupported delivery directory');
const out=path.join(root,delivery,'evidence',phase);await mkdir(out,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
const files=[...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean))]
 .filter(file=>!file.startsWith('docs/f3/')&&!file.startsWith('docs/f3r1/')&&!file.startsWith('docs/f3r94/')&&!file.startsWith('docs/f2/evidence/')).sort();
const manifest=[];for(const file of files)manifest.push(`${createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')}  ${file}`);
const manifestText=manifest.join('\n')+'\n',sourceHash=createHash('sha256').update(manifestText).digest('hex');
await writeFile(path.join(root,delivery,'F3_SOURCE_MANIFEST.sha256'),manifestText);
const report={phase,sourceHash,head:git('rev-parse','HEAD').trim(),baseline:'5eb1e095f77d63e9dbb0f08077ba4681e37d5f0c',node:process.version,steps:[],status:'RUNNING'};
const record=()=>writeFile(path.join(out,'runs.json'),JSON.stringify(report,null,2)+'\n');
const {LocalDatabase}=await import('./f3-d1-harness.mjs');
const inventoryDatabase=new LocalDatabase(),schema=inventoryDatabase.sqlite;
const tables=schema.prepare('PRAGMA table_list').all().filter(t=>!t.name.startsWith('sqlite_')).sort((a,b)=>a.name.localeCompare(b.name));
const inventory=tables.map(table=>({name:table.name,strict:table.strict,columns:schema.prepare(`PRAGMA table_info(${table.name})`).all(),
 foreignKeys:schema.prepare(`PRAGMA foreign_key_list(${table.name})`).all(),indexes:schema.prepare(`PRAGMA index_list(${table.name})`).all(),
 sql:schema.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get('table',table.name).sql}));
await writeFile(path.join(out,'schema-inventory.json'),JSON.stringify(inventory,null,2)+'\n');schema.close();
async function run(name,command,args,cwd,env=process.env,allowFailure=false) {
 const started=Date.now();
 const child=spawnSync(command,args,{cwd,env,encoding:'utf8',maxBuffer:64*1024*1024,timeout:1200000,stdio:['ignore','pipe','pipe']});
 const stdout=String(child.stdout??''),stderr=String(child.stderr??child.error?.message??''),exitCode=child.status??1;
 await writeFile(path.join(out,`${name}.stdout.log`),stdout);await writeFile(path.join(out,`${name}.stderr.log`),stderr);
 const summary={name,command:[command,...args],exitCode,durationMs:Date.now()-started};report.steps.push(summary);await record();
 console.log(`${phase}: ${name}: exit ${exitCode}`);
 if(exitCode!==0&&!allowFailure)throw new Error(`${name} failed; see raw logs`);
 const plain=stdout.replace(/\u001b\[[0-9;]*m/g,'').replace(/\r/g,'\n');
 if(['verify','worker-tests','dart-tests','mobile-tests'].includes(name)&&
   (/^(?:\u2139 |# )(?:fail|cancelled|skipped|todo) [1-9][0-9]*\s*$/m.test(plain)||/\+[0-9]+\s+~[1-9][0-9]*/.test(plain)))throw new Error(`${name}: hidden failures/skips/todos are forbidden`);
 return {stdout,stderr,summary};
}
const snapshot=await mkdtemp(path.join(tmpdir(),'helpy-f3-verification-'));
try {
 await run('source-clone','git',['clone','--shared',root,snapshot],root);
 for(const file of files){const destination=path.join(snapshot,file);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.join(root,file),destination);}
 await mkdir(path.join(snapshot,'docs/f2/evidence'),{recursive:true});
 const env={...process.env,FORCE_COLOR:'0',WRANGLER_SEND_METRICS:'false'};
 await run('npm-ci','npm',['ci'],snapshot,env);
 await run('verify','npm',['run','verify'],snapshot,env);
 const workerNode=process.env.F3_WORKER_NODE??process.execPath,workerEnv={...env,PATH:`${path.dirname(workerNode)}:${env.PATH}`};
 await run('worker-runtime',workerNode,['--version'],snapshot,workerEnv);
 for(const [name,script] of [['worker-types','worker:types:check'],['worker-typecheck','worker:typecheck'],['worker-build','worker:build'],['worker-tests','worker:test'],['probe-plan','provider:probes:plan'],['capacity-probe-plan','provider:d1-capacity:plan'],['provider-availability','provider:probes'],['capacity-provider-availability','provider:d1-capacity']])
  await run(name,'npm',['run',script,'--workspace','@helpy/backend'],snapshot,workerEnv);
  const flutter=process.env.F3_FLUTTER??'flutter',dart=process.env.F3_DART??'dart';
  const contracts=path.join(snapshot,'packages/contracts'),mobile=path.join(snapshot,'apps/mobile');
  const flutterRuntime=await run('flutter-runtime',flutter,['--version','--machine'],mobile,env);
  const flutterVersion=JSON.parse(flutterRuntime.stdout);
  if(flutterVersion.flutterVersion!=='3.47.2'||flutterVersion.dartSdkVersion!=='3.13.2')throw new Error('Flutter 3.47.2 / Dart 3.13.2 required by accepted F1');
  const dartRuntime=await run('dart-runtime',dart,['--version'],contracts,env);
  if(!`${dartRuntime.stdout}${dartRuntime.stderr}`.includes('Dart SDK version: 3.13.2'))throw new Error('Dart 3.13.2 required by accepted F1');
  for(const [name,args] of [['dart-restore',['pub','get','--enforce-lockfile']],['dart-format',['format','--output=none','--set-exit-if-changed','lib','test']],['dart-analyze',['analyze','--fatal-infos']],['dart-tests',['test']]])await run(name,dart,args,contracts,env);
  for(const [name,args] of [['mobile-restore',['pub','get','--enforce-lockfile']],['mobile-format',['format','--output=none','--set-exit-if-changed','lib','test']],['mobile-analyze',['analyze','--fatal-infos']],['mobile-tests',['test']]])await run(name,name==='mobile-format'?dart:flutter,args,mobile,env);
  if(phase==='self-acceptance') {
   await run('review-versions','code-review',['versions'],root,env);
   const targets=['apps/backend/src','apps/backend/test','apps/admin/src','apps/admin/test','apps/mobile/lib','apps/mobile/test',
    'packages/contracts/src','packages/contracts/lib','packages/contracts/scripts','packages/contracts/test','tests'];
   let index=0;
   for(const target of targets)for(const mode of ['gate','security','ast-scan']){
    const name=`review-${String(++index).padStart(3,'0')}-${mode}`;
    const actual=await run(name,'code-review',[mode,'--target',path.join(root,target),'--run-id',`f3-${phase}-${index}`],root,env);
    const review=JSON.parse(actual.stdout);actual.summary.target=target;actual.summary.mode=mode;
    actual.summary.applicability='applicable';await record();
    if(review.status!=='PASS'||review.summary.truncated||review.summary.finding_count!==0||review.summary.error_count!==0||review.summary.warning_count!==0)throw new Error(`${name}: review findings require correction`);
   }
 }
 await run('diff-check','git',['diff','--check'],root,env);
 report.status='PASS';await record();
}catch(error){report.status='FAIL';report.failure=error.message;await record();throw error;}
finally{await rm(snapshot,{recursive:true,force:true});}
