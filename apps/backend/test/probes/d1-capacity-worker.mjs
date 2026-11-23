import {capacityCases,runD1CapacityCase} from './d1-capacity-contract.mjs';
export default {
 async fetch(request,env){
  if(!env.F3_PROBE_TOKEN||request.headers.get('authorization')!==`Bearer ${env.F3_PROBE_TOKEN}`)return new Response(null,{status:401});
  const name=new URL(request.url).pathname.slice(1);
  if(request.method!=='POST'||!capacityCases.includes(name))return new Response(null,{status:400});
  try{return Response.json(await runD1CapacityCase(env.DB,name));}
  catch{return Response.json({scenario:name,status:'FAIL',error:'D1CapacityProbeFailed'},{status:503});}
 },
};
