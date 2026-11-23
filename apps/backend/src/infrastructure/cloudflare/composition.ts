import { DomainCore } from '../../application/domain-core.js';
import type { CorePorts } from '../../application/domain-core.js';
import { PhotoApplicationService } from '../../application/photo-service.js';
import type { HttpApplication } from '../../transport/http-handler.js';
import { failure } from '../../domain/core.js';
import { D1AtomicRepository } from '../d1/d1-atomic-repository.js';
import type { Database } from '../d1/d1-atomic-repository.js';
import { D1PhotoMetadataStore } from '../d1/d1-photo-metadata-store.js';
import { R2PhotoStore, photoMetadataLookup } from '../media/r2-photo-store.js';
import type { Bucket } from '../media/r2-photo-store.js';
import { CloudflareImageProcessor } from '../media/cloudflare-image-processor.js';
import type { Images } from '../media/cloudflare-image-processor.js';
import { LocalTextSafety } from '../text-safety/local-text-safety.js';
import { TyphoonTranslation } from '../translation/typhoon-translation.js';
import { WorkerClock } from '../clock/worker-clock.js';
import { createAccountAccess } from './account-access.js';
export interface Bindings {DB:Database;PHOTO_BUCKET:Bucket;IMAGES:Images;TYPHOON_API_KEY:string;TYPHOON_BASE_URL:string;TYPHOON_MODEL:string}
export function compose(env:Bindings):HttpApplication {
  const repository=new D1AtomicRepository(env.DB),metadata=new D1PhotoMetadataStore(repository),objects=new R2PhotoStore(env.PHOTO_BUCKET);
  // Future provider authority is deliberately unavailable, never inferred from request data.
  const ports:CorePorts={repository,clock:new WorkerClock(),photos:photoMetadataLookup(metadata,objects),textSafety:new LocalTextSafety(),
    translation:new TyphoonTranslation(env.TYPHOON_API_KEY,fetch,15000,env.TYPHOON_BASE_URL,env.TYPHOON_MODEL),
    auth:{async authenticate(){return failure('Unauthorized');},async verifyClaim(){return failure('ContactUnverified');}},
    payments:{async incomingRoute(){return failure('RouteUnavailable');},async verifyOutcome(){return failure('ProviderConflict');},
      async payoutDestination(){return failure('DestinationUnverified');},async settlementDestination(){return failure('DestinationUnverified');}},
    notifications:{supportedChannels:[],async deliver(){return failure('RouteUnavailable');}},
    directory:{async admins(){throw new Error('Authorization directory unavailable');}},supportAttachments:{photosAllowed(){return false;}},
    legalRetention:{validate(){return failure('RetentionBlocked');},restrictions(){return failure('RetentionBlocked');}}};
  const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join('');
  return {core:new DomainCore(ports),ports,accountAccess:createAccountAccess(ports),photos:new PhotoApplicationService(repository,ports.auth,metadata,objects,new CloudflareImageProcessor(env.IMAGES),digest)};
}
