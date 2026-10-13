import type { ReactNode } from 'react';

export type Sistema = 'linux' | 'macos' | 'windows';

export const SISTEMAS: Record<Sistema, string> = { linux: 'Linux', macos: 'macOS', windows: 'Windows' };

/** Sistema de quem visita, pelo navegador. Celular e desconhecido dão nulo. */
export function detectarSistema(): Sistema | null {
  if (typeof navigator === 'undefined') return null;
  const dados = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  const texto = `${dados?.platform ?? ''} ${navigator.userAgent}`.toLowerCase();
  if (dados?.mobile === true || /android|iphone|ipad|mobile/.test(texto)) return null;
  if (texto.includes('win')) return 'windows';
  if (texto.includes('mac')) return 'macos';
  if (texto.includes('linux') || texto.includes('x11') || texto.includes('cros')) return 'linux';
  return null;
}

/** Botão principal de download: já diz o sistema detectado, com "Outras plataformas" ao lado. */
export function BotaoDeDownload({ nome, prefixo = '' }: { nome: string; prefixo?: string }): ReactNode {
  const sistema = detectarSistema();
  return (
    <div className="baixar-botoes">
      <a className="botao primario grande" href={`${prefixo}#baixar${sistema ? `-${sistema}` : ''}`}>
        {sistema ? `Baixar para ${SISTEMAS[sistema]}` : `Baixar o ${nome}`}
      </a>
      <a className="link-discreto" href={`${prefixo}#baixar`}>Outras plataformas</a>
    </div>
  );
}
