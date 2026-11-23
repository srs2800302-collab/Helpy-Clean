export const d1PlatformMaxBytes=2000000;
export const d1ValueMaxBytes=1000000;
export const d1RowMaxBytes=1500000;
export type D1Value=string|number|null|ArrayBuffer|ArrayBufferView;

export class D1CapacityError extends Error {
  readonly code='RepositoryUnavailable';
  constructor(){super('D1 application capacity exceeded');}
}
function valueBytes(value:unknown,sizes?:Map<string,number>):number {
  let bytes:number;
  if(typeof value==='string'){
    const known=sizes?.get(value);if(known!==undefined)return known;
    // UTF-8 is never shorter than the number of UTF-16 code units.
    if(value.length>d1ValueMaxBytes)throw new D1CapacityError();
    bytes=0;
    for(let index=0;index<value.length;index++){
      const unit=value.charCodeAt(index);
      if(unit<0x80)bytes++;
      else if(unit<0x800)bytes+=2;
      else if(unit>=0xd800&&unit<=0xdbff){
        const next=value.charCodeAt(++index);
        if(!(next>=0xdc00&&next<=0xdfff))throw new D1CapacityError();
        bytes+=4;
      }else if(unit>=0xdc00&&unit<=0xdfff)throw new D1CapacityError();
      else bytes+=3;
      if(bytes>d1ValueMaxBytes)throw new D1CapacityError();
    }
    if(bytes<=d1ValueMaxBytes)sizes?.set(value,bytes);
  }else if(value===null)return 0;
  else if(typeof value==='number'&&Number.isSafeInteger(value))return 8;
  else if(value instanceof ArrayBuffer||ArrayBuffer.isView(value))bytes=value.byteLength;
  else throw new D1CapacityError();
  if(bytes>d1ValueMaxBytes)throw new D1CapacityError();return bytes;
}
export function assertD1Values(values:readonly unknown[]):void {for(const value of values)valueBytes(value);}
export function assertD1Row(row:Readonly<Record<string,unknown>>,sizes=new Map<string,number>()):number {
  // Conservatively include SQLite record/header/serial-type and row-id overhead.
  // The remaining 500 KB margin is not available to application payloads.
  let bytes=64;
  for(const value of Object.values(row)){bytes+=16+valueBytes(value,sizes);if(bytes>d1RowMaxBytes)throw new D1CapacityError();}
  return bytes;
}
