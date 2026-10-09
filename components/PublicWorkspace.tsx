'use client';
import {useEffect,useRef} from 'react';
import {mountPublic} from '../public/sim/public.js';
export default function PublicWorkspace(){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{const el=host.current;if(!el)return;const shadow=el.shadowRoot??el.attachShadow({mode:'open'});shadow.innerHTML='<link rel="stylesheet" href="/sim/public.css"><div id="public-app"></div>';return mountPublic(shadow);},[]);
  return <div ref={host} style={{minHeight:'100dvh'}} aria-label="Shape Is Money"/>;
}
