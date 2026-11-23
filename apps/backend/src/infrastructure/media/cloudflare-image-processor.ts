import type { ImageProcessorPort } from '../../application/photo-ports.js';
import { failure, success } from '../../domain/core.js';
interface Transformer {
  transform(options:{width:number;height:number;fit:'scale-down'}):Transformer;
  output(options:{format:'image/webp';quality:number}):Promise<{image():ReadableStream<Uint8Array>}>;
}
export interface Images {
  info(stream:ReadableStream<Uint8Array>):Promise<{format:string;width?:number;height?:number}>;
  input(stream:ReadableStream<Uint8Array>):Transformer;
}
const stream=(bytes:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
export class CloudflareImageProcessor implements ImageProcessorPort {
  constructor(private readonly images:Images) {}
  async process(source:Uint8Array,mime:string,limit:number) {
    if(!['image/jpeg','image/png','image/webp'].includes(mime)||source.length===0||source.length>10485760||!Number.isSafeInteger(limit)||limit<=0)return failure('InvalidPhoto');
    try {
      const info=await this.images.info(stream(source));
      if(info.format!==mime||!info.width||!info.height||!Number.isSafeInteger(info.width)||!Number.isSafeInteger(info.height)||info.width<=0||info.height<=0||info.width*info.height>100000000)return failure('InvalidPhoto');
      const output=await this.images.input(stream(source)).transform({width:1920,height:1920,fit:'scale-down'}).output({format:'image/webp',quality:80});
      const reader=output.image().getReader(),chunks:Uint8Array[]=[];let length=0;
      for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();return failure('InvalidPhoto');}chunks.push(value);}
      if(!length)return failure('InvalidPhoto');const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const ascii=(at:number)=>String.fromCharCode(...bytes.slice(at,at+4));
      if(length<12||ascii(0)!=='RIFF'||ascii(8)!=='WEBP')return failure('InvalidPhoto');
      const view=new DataView(bytes.buffer);if(view.getUint32(4,true)!==length-8)return failure('InvalidPhoto');
      const kept:Uint8Array[]=[];let size=12;
      // Enforce metadata removal independently of the provider's encoding defaults.
      for(let at=12;at<length;){
        if(at+8>length)return failure('InvalidPhoto');
        const chunkLength=view.getUint32(at+4,true),end=at+8+chunkLength+(chunkLength%2);
        if(end>length)return failure('InvalidPhoto');const kind=ascii(at),chunk=bytes.slice(at,end);
        if(kind!=='EXIF'&&kind!=='XMP '){if(kind==='VP8X'&&chunkLength>=10)chunk[8]=chunk[8]!&~12;kept.push(chunk);size+=chunk.length;}
        at=end;
      }
      const clean=new Uint8Array(size);clean.set(bytes.slice(0,12));new DataView(clean.buffer).setUint32(4,size-8,true);let at=12;
      for(const chunk of kept){clean.set(chunk,at);at+=chunk.length;}return success(clean);
    }catch(error){return error&&typeof error==='object'&&'code' in error&&error.code===9412?failure('InvalidPhoto'):
      {ok:false as const,error:{code:'InfrastructureUnavailable' as const,detail:'InfrastructureUnavailable'}};}
  }
}
