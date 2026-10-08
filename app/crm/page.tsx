import {requireChatGPTUser} from '../chatgpt-auth';
import SIMWorkspace from '../../components/SIMWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/crm');return <SIMWorkspace/>;}
