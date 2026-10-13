/**
 * Endereços do YouTube (J109). Um vídeo do YouTube é reconhecido pelo id de 11 caracteres, venha ele
 * de `youtube.com/watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/`, `/v/`, `m.`, `music.` ou
 * `youtube-nocookie.com`. O serviço usa o id para recusar URL que não é do YouTube (400) e achar o vídeo
 * já importado (409); o leitor, para decidir tocar pelo player oficial embutido.
 *
 * Puro: sem DOM, sem rede.
 */

/** Id de vídeo do YouTube: 11 caracteres de base64 para URL. */
export const PADRAO_DO_ID_DO_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

const HOSTS_DO_YOUTUBE = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const PREFIXOS_DE_CAMINHO = ['embed', 'shorts', 'live', 'v', 'e'];

/**
 * O id do vídeo, ou `null` se a URL não aponta para um vídeo do YouTube. Aceita só http e https;
 * listas sem vídeo (`/playlist?list=`), canais e buscas devolvem `null`.
 */
export function idDoVideoDoYoutube(entrada: string): string | null {
  const bruto = entrada.trim();
  if (bruto === '' || bruto.length > 4096) return null;
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(bruto) ? bruto : `https://${bruto}`); }
  catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  const partes = url.pathname.split('/').filter(Boolean);
  let candidato: string | null | undefined = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidato = partes[0];
  } else if (HOSTS_DO_YOUTUBE.has(host)) {
    if (partes[0] === 'watch') candidato = url.searchParams.get('v');
    else if (partes.length >= 2 && PREFIXOS_DE_CAMINHO.includes(partes[0]!)) candidato = partes[1];
    else if (partes.length === 0 || partes[0] === 'attribution_link') {
      // `youtube.com/?v=ID` e o link de atribuição (`/attribution_link?u=/watch?v=ID`).
      candidato = url.searchParams.get('v');
      const interna = url.searchParams.get('u');
      if (candidato === null && interna !== null && interna.startsWith('/')) return idDoVideoDoYoutube(`https://www.youtube.com${interna}`);
    }
  }
  return candidato !== undefined && candidato !== null && PADRAO_DO_ID_DO_YOUTUBE.test(candidato) ? candidato : null;
}

/** A URL canônica de assistir (a que fica gravada e vira o link "Assistir no YouTube"). */
export function urlDeAssistirNoYoutube(id: string, inicio_s?: number): string {
  if (!PADRAO_DO_ID_DO_YOUTUBE.test(id)) throw new Error('Id de vídeo do YouTube inválido.');
  const inicio = inicio_s !== undefined && Number.isFinite(inicio_s) && inicio_s >= 1 ? `&t=${String(Math.floor(inicio_s))}s` : '';
  return `https://www.youtube.com/watch?v=${id}${inicio}`;
}

/**
 * O endereço do player embutido: `enablejsapi=1` para a IFrame Player API, `origin` com a origem da
 * página (esquema + host + porta, como a documentação pede), `playsinline` para o iPhone não abrir
 * a tela cheia, `rel=0` para os relacionados serem do mesmo canal e `start` para a posição lembrada.
 */
export function urlDoPlayerDoYoutube(id: string, opcoes: { origem: string; inicio_s?: number }): string {
  if (!PADRAO_DO_ID_DO_YOUTUBE.test(id)) throw new Error('Id de vídeo do YouTube inválido.');
  const origem = new URL(opcoes.origem).origin;
  const parametros = new URLSearchParams({ enablejsapi: '1', origin: origem, playsinline: '1', rel: '0' });
  if (opcoes.inicio_s !== undefined && Number.isFinite(opcoes.inicio_s) && opcoes.inicio_s >= 1) parametros.set('start', String(Math.floor(opcoes.inicio_s)));
  return `https://www.youtube.com/embed/${id}?${parametros.toString()}`;
}
