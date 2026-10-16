/**
 * S-01 · Chave local do app de computador, vista da página. O serviço do app exige a chave em toda a API;
 * a página a recebe do processo principal pelo preload (`window.margemDesktop.chaveLocal`) e a troca, uma
 * vez ao abrir, pelo cookie da sessão (`POST /api/sessao`, `HttpOnly`, `SameSite=Strict`). O cookie cobre
 * o que a página carrega sem `fetch`: o PDF original, o `EventSource`, imagens, áudio e vídeo.
 *
 * No navegador (desenvolvimento, Docker, um servidor pessoal) não há ponte e nada acontece.
 */
export type PonteDaChave = () => Promise<string>;

export function ponteDaChave(): PonteDaChave | null {
  const ponte = (window as { margemDesktop?: { chaveLocal?: unknown } }).margemDesktop?.chaveLocal;
  return typeof ponte === 'function' ? ponte as PonteDaChave : null;
}

/** Abre a sessão da janela do app (o cookie da chave). Falha não impede a página de abrir: a API explica com 401. */
export async function abrirSessaoDoDesktop(ponte: PonteDaChave | null = ponteDaChave()): Promise<void> {
  if (ponte === null) return;
  try {
    const chave = await ponte();
    const resposta = await fetch('/api/sessao', { method: 'POST', credentials: 'same-origin', headers: { 'X-Margem': '1', Authorization: `Bearer ${chave}` } });
    if (!resposta.ok) console.warn(`Margem: a sessão do app não abriu (${String(resposta.status)}).`);
  } catch {
    console.warn('Margem: a sessão do app não abriu.');
  }
}
