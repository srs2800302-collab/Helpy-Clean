import {DomainCore} from '../../application/domain-core.js';
import type {CorePorts} from '../../application/domain-core.js';
import * as Validate from '../../application/validation.js';
import {failure} from '../../domain/core.js';

type VerifiedClaim=Extract<Awaited<ReturnType<CorePorts['auth']['verifyClaim']>>,{ok:true}>['value'];

export async function accountCandidateId(claim:VerifiedClaim):Promise<string> {
  const data=JSON.stringify(['helpy-account-v1',claim.id,claim.identity.method,claim.identity.subject]);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)));
  return `user:${Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('')}`;
}

export function createAccountAccess(ports:CorePorts):(proof:string,operationId:string,recovery:boolean)=>ReturnType<DomainCore['authenticate']> {
  return async(proof,operationId,recovery)=>{
    const verified=await Validate.callPort(()=>ports.auth.verifyClaim(proof),Validate.claim,'ContactUnverified');
    if(!verified.ok)return verified;
    const id=recovery?verified.value.ownerId:await accountCandidateId(verified.value);
    if(!id)return failure('ContactUnverified');
    // Verification may redeem a one-time provider proof. Bind that exact verified
    // result to this call; F2 still enforces purpose, expiry, ownership and receipts.
    const core=new DomainCore({...ports,auth:{
      authenticate:session=>ports.auth.authenticate(session),
      verifyClaim:async supplied=>supplied===proof?structuredClone(verified):failure('ContactUnverified'),
    }});
    return core.authenticate(proof,id,operationId,recovery);
  };
}
