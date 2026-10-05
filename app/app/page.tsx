import {requireChatGPTUser} from '../chatgpt-auth';
import Platform from '../../components/Platform';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/app');return <Platform/>;}
