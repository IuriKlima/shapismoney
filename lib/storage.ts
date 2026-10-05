import {env} from 'cloudflare:workers';
import {createState,type State} from './domain';
export function database(){const db=(env as unknown as {DB:D1Database}).DB;if(!db)throw Error('Banco de dados indisponível.');return db;}
export function bucket(){return (env as unknown as {BUCKET:R2Bucket}).BUCKET;}
export async function loadState(owner:string){const db=database();let row=await db.prepare('SELECT data, revision FROM workspaces WHERE id = ?').bind(owner).first<{data:string;revision:number}>();if(!row){await db.prepare('INSERT OR IGNORE INTO workspaces (id,data,revision) VALUES (?,?,0)').bind(owner,JSON.stringify(createState())).run();row=await db.prepare('SELECT data, revision FROM workspaces WHERE id = ?').bind(owner).first<{data:string;revision:number}>();}if(!row)throw Error('Não foi possível carregar os dados.');return {state:JSON.parse(row.data) as State,revision:row.revision};}
export async function saveState(owner:string,state:State,revision:number){const result=await database().prepare('UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(state),owner,revision).run();return result.meta.changes===1;}
