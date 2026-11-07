// Shared validation for student drawings in the browser, server and offline demo.
globalThis.studentSketchInput=(()=>{
 const maxBytes=5*1024*1024,types=['image/png','image/jpeg','image/webp'];
 const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
 function decode(value){
  if(value==null)return null;
  if(typeof value!=='string')fail(400,'그림은 PNG, JPEG, WebP 이미지로 첨부해 주세요.');
  const match=value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)fail(400,'그림은 PNG, JPEG, WebP 이미지로 첨부해 주세요.');
  if(match[2].length>4*Math.ceil(maxBytes/3))fail(413,'학생 그림은 5MB 이하로 첨부해 주세요.');
  let binary;try{binary=atob(match[2]);if(btoa(binary)!==match[2])throw Error();}catch{fail(400,'그림 파일을 읽을 수 없습니다. 다시 선택해 주세요.');}
  if(binary.length>maxBytes)fail(413,'학생 그림은 5MB 이하로 첨부해 주세요.');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),mime=match[1],view=new DataView(bytes.buffer);
  const word=(start,end)=>String.fromCharCode(...bytes.subarray(start,end));
  let valid=false;
  if(mime==='image/png')valid=bytes.length>=45&&word(0,8)==='\x89PNG\r\n\x1a\n'&&view.getUint32(8)===13&&word(12,16)==='IHDR'&&view.getUint32(16)>0&&view.getUint32(20)>0&&view.getUint32(bytes.length-12)===0&&word(bytes.length-8,bytes.length-4)==='IEND';
  if(mime==='image/jpeg')valid=bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
  if(mime==='image/webp')valid=bytes.length>=20&&word(0,4)==='RIFF'&&word(8,12)==='WEBP'&&view.getUint32(4,true)+8===bytes.length&&['VP8 ','VP8L','VP8X'].includes(word(12,16));
  if(!valid)fail(400,'그림의 파일 형식이 맞지 않거나 손상되었습니다. 다른 PNG, JPEG, WebP 파일을 선택해 주세요.');
  return {bytes,mime,size:bytes.length};
 }
 return {maxBytes,types,decode};
})();
