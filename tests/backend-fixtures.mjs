import {randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openLocalStore} from '../backend/store.mjs';
import {hashPassword} from '../backend/auth.mjs';
export const FIXTURE_PASSWORD='Testing-only-fictitious-2026!';
export async function isolatedFixture(){
  const directory=mkdtempSync(path.join(os.tmpdir(),'sim-backend-test-'));
  const actual=realpathSync(directory),temporary=realpathSync(os.tmpdir());
  if(!actual.startsWith(temporary+path.sep))throw Error('Fixtures must remain in a temporary isolated directory.');
  const filename=path.join(actual,'test.sqlite');const store=openLocalStore(filename);const org=randomUUID(),otherOrg=randomUUID();
  const ids={coach:randomUUID(),otherCoach:randomUUID(),nutrition:randomUUID(),student:randomUUID(),otherStudent:randomUUID(),outsider:randomUUID(),admin:randomUUID(),studentRecord:randomUUID(),otherRecord:randomUUID()};
  const hash=await hashPassword(FIXTURE_PASSWORD);
  store.transaction(()=>{
    store.run('INSERT INTO organizations VALUES (?,?)',org,'Organização fictícia');store.run('INSERT INTO organizations VALUES (?,?)',otherOrg,'Outro tenant fictício');
    for(const [key,role,tenant] of [['coach','coach',org],['otherCoach','coach',org],['nutrition','nutrition',org],['student','student',org],['otherStudent','student',org],['outsider','coach',otherOrg],['admin','admin',org]])store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',ids[key],tenant,key.toLowerCase()+'@fixture.invalid','Fictício '+key,role,hash);
    store.run('INSERT INTO students(id,org_id,user_id,coach_id,nutrition_id,email,name,internal_note) VALUES (?,?,?,?,?,?,?,?)',ids.studentRecord,org,ids.student,ids.coach,ids.nutrition,'student@fixture.invalid','Aluno fictício','INTERNO: somente equipe vinculada');
    store.run('INSERT INTO students(id,org_id,user_id,coach_id,email,name,internal_note) VALUES (?,?,?,?,?,?,?)',ids.otherRecord,org,ids.otherStudent,ids.otherCoach,'otherstudent@fixture.invalid','Outro aluno fictício','INTERNO OUTRO COACH');
  });return {directory,filename,store,ids};
}
