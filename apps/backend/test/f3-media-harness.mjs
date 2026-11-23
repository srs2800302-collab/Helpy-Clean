export function bucket() {
 const data=new Map();
 return {data,puts:0,
  async head(key){return data.get(key)??null;},
  async get(key){const row=data.get(key);return row?{async arrayBuffer(){return row.bytes.slice().buffer;}}:null;},
  async put(key,bytes,options){
   if(options.onlyIf.etagDoesNotMatch!=='*'||options.httpMetadata.contentType!=='image/webp')throw new Error('Invalid object write');
   if(data.has(key))return null;this.puts++;const row={bytes:bytes.slice(),customMetadata:options.customMetadata};data.set(key,row);return row;
  },
 };
}
