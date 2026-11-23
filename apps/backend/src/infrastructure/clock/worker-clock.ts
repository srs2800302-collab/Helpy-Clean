import type { Clock, Period } from '../../domain/core.js';
export class WorkerClock implements Clock {
  now():number {return Math.floor(Date.now()/1000);}
  add(anchor:number,period:Period):number {
    if(!Number.isSafeInteger(anchor)||!Number.isSafeInteger(period.value)||period.value<=0)throw new Error('Invalid clock input');
    let result:number;
    if(period.unit==='seconds')result=anchor+period.value;
    else if(period.unit==='days')result=anchor+period.value*86400;
    else if(period.unit==='years') {const date=new Date(anchor*1000);date.setUTCFullYear(date.getUTCFullYear()+period.value);result=date.getTime()/1000;}
    else throw new Error('Invalid clock unit');
    if(!Number.isSafeInteger(result))throw new Error('Clock range exceeded');
    return result;
  }
}
