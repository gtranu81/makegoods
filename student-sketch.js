import './public/sketch-input.js';
export function findStudentSketch(db,requestId,userId,includeData=true){
 const seen=new Set();
 while(requestId&&!seen.has(requestId)){
  seen.add(requestId);
  const row=db.prepare('SELECT id,parent_id,user_id FROM requests WHERE id=? AND user_id=?').get(requestId,userId);if(!row)return null;
  const sketch=db.prepare('SELECT request_id,mime,length(data) size,sha256,created_at'+(includeData?',data':'')+' FROM student_sketches WHERE request_id=?').get(row.id);
  if(sketch)return sketch;
  requestId=row.parent_id;
 }
 return null;
}
export function sketchReference(sketch){return sketch?{requestId:sketch.request_id,imageUrl:`/api/requests/${sketch.request_id}/sketch`,mime:sketch.mime,size:sketch.size??sketch.data.byteLength,sha256:sketch.sha256}:null;}
export function sketchDataUrl(sketch){return `data:${sketch.mime};base64,${Buffer.from(sketch.data).toString('base64')}`;}
