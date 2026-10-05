import {requireChatGPTUser} from '../chatgpt-auth';
import Onboarding from '../../components/Onboarding';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/comecar');return <Onboarding/>;}
