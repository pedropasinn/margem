/**
 * Atalhos de teclado por sistema (J154). No Mac o que é Ctrl no Windows e no Linux é ⌘ (Command): os
 * ouvintes aceitam os dois (`comComando`) e os rótulos mostram ⌘, ⇧ e ⌥ no Mac (`atalhoNoSistema`).
 * No app de computador o sistema vem da ponte do Electron; no navegador, do `navigator`.
 */

interface NavegadorParecido { platform?: string; userAgent?: string; userAgentData?: { platform?: string } }

/** Estamos num Mac (ou iPad/iPhone com teclado, que também usam ⌘)? */
export function ehMac(
  nav: NavegadorParecido | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  ponte: unknown = typeof window === 'undefined' ? undefined : (window as { margemDesktop?: unknown }).margemDesktop,
): boolean {
  const sistema = (ponte as { janela?: { sistema?: unknown } } | undefined)?.janela?.sistema;
  if (typeof sistema === 'string') return sistema === 'darwin';
  const plataforma = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
  return /mac|iphone|ipad|ipod/iu.test(plataforma);
}

/** Ctrl (ou ⌘ no Mac) apertado: os atalhos com Ctrl valem com Command no Mac. */
export function comComando(evento: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return evento.ctrlKey || evento.metaKey;
}

const NO_MAC: Readonly<Record<string, string>> = { Ctrl: '⌘', Shift: '⇧', Alt: '⌥' };

/** Uma tecla de um atalho (`Ctrl`, `Shift`, `K`) como o sistema mostra. */
export function teclaNoSistema(tecla: string, mac: boolean = ehMac()): string {
  return mac ? NO_MAC[tecla] ?? tecla : tecla;
}

/** Um atalho escrito com espaço ou `+` entre as teclas (`Shift Ctrl S`, `Ctrl+O`) como o sistema mostra. */
export function atalhoNoSistema(atalho: string, mac: boolean = ehMac()): string {
  if (!mac) return atalho;
  return atalho.split(/(\s+|\+(?=\S))/u).map((parte) => NO_MAC[parte] ?? parte).join('');
}

/** Num texto corrido ("use Ctrl F", "Ctrl + roda do mouse"), Ctrl vira ⌘ no Mac. */
export function textoNoSistema(texto: string, mac: boolean = ehMac()): string {
  return mac ? texto.replace(/\bCtrl\b/gu, '⌘') : texto;
}
