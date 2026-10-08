import {requireChatGPTUser} from '../chatgpt-auth';
import SIMWorkspace from '../../components/SIMWorkspace';
import Platform from '../../components/Platform';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{legacy?:string}>}){await requireChatGPTUser('/app');return (await searchParams).legacy==='1'&&process.env.NODE_ENV==='development'?<Platform/>:<SIMWorkspace/>;}
