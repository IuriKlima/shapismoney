import {requireChatGPTUser} from '../chatgpt-auth';
import SIMWorkspace from '../../components/SIMWorkspace';
import Onboarding from '../../components/Onboarding';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{legacy?:string;anamnese?:string}>}){await requireChatGPTUser('/comecar');return (await searchParams).legacy==='1'&&process.env.NODE_ENV==='development'?<Onboarding initialStep={(await searchParams).anamnese?2:1}/>:<SIMWorkspace/>;}
