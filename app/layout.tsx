import type {Metadata} from 'next';import './globals.css';
export const metadata:Metadata={title:'Shape IS Money | Seu próximo nível',description:'Treino personalizado, evolução e uma comunidade que cresce com você. Shape IS Money.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>;}
