const decimalDigit=/\p{Nd}/u;
const digits=new Map<number,string>();

// Unicode decimal digit sets are contiguous runs of ten (some runs contain
// several adjacent sets). Never coerce a complete number through IEEE-754.
export function foldDecimalDigits(text:string):string {
  return text.replace(/\p{Nd}/gu,character=>{
    const point=character.codePointAt(0)!;
    let value=digits.get(point);
    if(value===undefined){
      let zero=point;
      while(zero>0&&decimalDigit.test(String.fromCodePoint(zero-1)))zero--;
      value=String((point-zero)%10);digits.set(point,value);
    }
    return value;
  });
}
