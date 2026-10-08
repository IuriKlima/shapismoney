'use client';

import {useEffect, useRef} from 'react';
import {mountSIM} from '../public/sim/app.js';

export default function SIMWorkspace() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const shadow = element.shadowRoot ?? element.attachShadow({mode: 'open'});
    shadow.innerHTML = '<link rel="stylesheet" href="/sim/style.css"><div id="app"></div><div id="modal-root"></div><div id="toast" role="status" aria-live="polite"></div>';
    try {return mountSIM(shadow);}
    catch {shadow.innerHTML = '<p style="padding:32px">Não foi possível carregar a base local. Recarregue para tentar novamente.</p>';}
  }, []);
  return <div ref={host} style={{minHeight: '100dvh'}} aria-label="Shape Is Money — base demonstrativa" />;
}
