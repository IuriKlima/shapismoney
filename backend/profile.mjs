import sharp from 'sharp';
export function profileFlow({store,deny,exact,text,read,student,mutation,audit}){
  const dto=(row,profile)=>({displayName:profile?.display_name??row.name,bio:profile?.bio??'',revision:profile?.revision??0,photoUrl:profile?.photo?'/api/local/students/'+row.id+'/profile/photo?v='+profile.revision:null});
  async function handle(actor,req,res,route){
    const match=/^\/api\/local\/students\/([A-Za-z0-9-]+)\/profile(\/photo)?$/.exec(route);if(!match)return null;const row=await student(actor,match[1]);const profile=await store.get('SELECT * FROM student_profiles WHERE student_id=?',row.id);
    if(req.method==='GET'){if(match[2]){if(!profile?.photo)deny(404,'Foto não encontrada.');res.writeHead(200,{'Content-Type':'image/webp','Content-Length':Buffer.from(profile.photo,'base64').length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(Buffer.from(profile.photo,'base64'));return {binary:true};}return {status:200,data:{profile:dto(row,profile)}};}
    if(actor.role!=='student'||row.user_id!==actor.id||actor.org_id!==row.org_id)deny(403,'Somente o dono pode editar este perfil.');
    if(req.method!=='PUT')deny(405,'Método não permitido.');const body=await read(req,3*1024*1024);
    if(!Number.isInteger(body.revision)||body.revision<0)deny(400,'Revisão inválida.');let photo;
    if(match[2]){exact(body,['revision','image','type']);if(body.image===null&&body.type===null)photo=null;else{
      if(!['image/jpeg','image/png','image/webp'].includes(body.type)||typeof body.image!=='string'||body.image.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.image))deny(400,'Use JPEG, PNG ou WebP de até 2 MB.');
      const bytes=Buffer.from(body.image,'base64');if(bytes.length>2*1024*1024||bytes.length<20)deny(413,'Use foto de até 2 MB.');
      const matches={'image/jpeg':bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'image/png':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/webp':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'};
      if(!matches[body.type])deny(400,'O conteúdo não corresponde ao tipo de imagem.');
      try{const image=sharp(bytes,{limitInputPixels:16000000,animated:false,failOn:'warning'});const meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format)||meta.pages>1||{'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[body.type]!==meta.format)deny(400,'Formato inválido ou animado.');photo=(await image.rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer()).toString('base64');}catch{deny(400,'Imagem inválida. Use uma foto estática de até 16 milhões de pixels.');}
    }}else{exact(body,['revision','displayName','bio']);text(body.displayName,2,80);text(body.bio,0,280);}
    return await mutation(actor,req,body,async()=>{await store.lockStudent(row.id);const live=await student(actor,row.id);if(live.user_id!==actor.id)deny(403,'Vínculo mudou.');const current=await store.get('SELECT * FROM student_profiles WHERE student_id=?',row.id);if(body.revision!==(current?.revision??0))deny(409,'Perfil mudou. Recarregue antes de salvar.');
      if(!current)await store.run('INSERT INTO student_profiles(student_id,display_name,revision) VALUES (?,?,0)',row.id,row.name);
      if(match[2])await store.run('UPDATE student_profiles SET photo=?,revision=revision+1 WHERE student_id=?',photo,row.id);else await store.run('UPDATE student_profiles SET display_name=?,bio=?,revision=revision+1 WHERE student_id=?',body.displayName.trim(),body.bio.trim(),row.id);
      await audit(actor,row.id,match[2]?'student.profile.photo.updated':'student.profile.updated');return {status:200,data:{profile:dto(row,await store.get('SELECT * FROM student_profiles WHERE student_id=?',row.id))}};
    });
  }
  return {handle};
}
