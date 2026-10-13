/**
 * Enviar para o Obsidian: preferências (cofre e pasta, só neste navegador), a URI `obsidian://new`
 * e o pedido da nota à API. A nota é gerada pelo serviço (`GET /api/documentos/:id/obsidian.md`);
 * aqui só se decide como entregá-la.
 *
 * A URI leva o conteúdo inteiro no parâmetro `content`. Acima de `LIMITE_DA_URI` caracteres (o
 * sistema operacional repassa a URI como linha de comando, e o Windows corta em 32 767), o conteúdo
 * vai pela área de transferência e a URI leva `clipboard`, que o Obsidian lê no lugar de `content`.
 */
export interface PreferenciasDoObsidian {
  /** Nome do cofre (vault). Vazio: o Obsidian abre no cofre que estiver aberto. */
  cofre: string;
  /** Pasta dentro do cofre, sem barras nas pontas. */
  pasta: string;
  marcas: 'minhas' | 'todas';
  /** Com `overwrite`, a nota com o mesmo nome é substituída; sem ele, o Obsidian cria outra. */
  substituir: boolean;
}

export const PREFERENCIAS_DO_OBSIDIAN_PADRAO: PreferenciasDoObsidian = { cofre: '', pasta: 'Margem', marcas: 'minhas', substituir: false };
const CHAVE = 'margem:obsidian';
export const LIMITE_DA_URI = 24_000;

/** Pasta como caminho relativo do cofre: barras normalizadas, sem `.`/`..`, sem barras nas pontas. */
export function limparPasta(pasta: string): string {
  return pasta.replace(/\\/g, '/').split('/').map((parte) => parte.trim()).filter((parte) => parte !== '' && parte !== '.' && parte !== '..').join('/');
}

export function validarPreferenciasDoObsidian(valor: unknown): PreferenciasDoObsidian {
  if (typeof valor !== 'object' || valor === null) return { ...PREFERENCIAS_DO_OBSIDIAN_PADRAO };
  const v = valor as Record<string, unknown>;
  return {
    cofre: typeof v['cofre'] === 'string' ? v['cofre'].trim().slice(0, 200) : '',
    pasta: typeof v['pasta'] === 'string' ? limparPasta(v['pasta']).slice(0, 300) : PREFERENCIAS_DO_OBSIDIAN_PADRAO.pasta,
    marcas: v['marcas'] === 'todas' ? 'todas' : 'minhas',
    substituir: v['substituir'] === true,
  };
}

export function lerPreferenciasDoObsidian(): PreferenciasDoObsidian {
  try { return validarPreferenciasDoObsidian(JSON.parse(localStorage.getItem(CHAVE) ?? 'null')); }
  catch { return { ...PREFERENCIAS_DO_OBSIDIAN_PADRAO }; }
}

export function gravarPreferenciasDoObsidian(preferencias: PreferenciasDoObsidian): void {
  try { localStorage.setItem(CHAVE, JSON.stringify(validarPreferenciasDoObsidian(preferencias))); } catch { /* sem storage: vale só nesta visita */ }
}

/** Caminho da nota no cofre, sem `.md` (o Obsidian acrescenta). */
export function caminhoNoCofre(pasta: string, arquivo: string): string {
  const nome = arquivo.replace(/\.md$/i, '');
  const limpa = limparPasta(pasta);
  return limpa === '' ? nome : `${limpa}/${nome}`;
}

function parametros(pares: [string, string | true][]): string {
  return pares.map(([chave, valor]) => (valor === true ? chave : `${chave}=${encodeURIComponent(valor)}`)).join('&');
}

export type UriDoObsidian = { via: 'conteudo'; uri: string } | { via: 'area_de_transferencia'; uri: string };

/** A URI que cria a nota: com o conteúdo, ou (grande demais) lendo a área de transferência. */
export function uriDoObsidian(entrada: { cofre: string; caminho: string; conteudo: string; substituir: boolean }): UriDoObsidian {
  const comuns: [string, string | true][] = [
    ...(entrada.cofre.trim() === '' ? [] : [['vault', entrada.cofre.trim()] as [string, string]]),
    ['file', entrada.caminho],
  ];
  const fim: [string, string | true][] = entrada.substituir ? [['overwrite', 'true']] : [];
  const comConteudo = `obsidian://new?${parametros([...comuns, ['content', entrada.conteudo], ...fim])}`;
  if (comConteudo.length <= LIMITE_DA_URI) return { via: 'conteudo', uri: comConteudo };
  return { via: 'area_de_transferencia', uri: `obsidian://new?${parametros([...comuns, ['clipboard', 'true'], ...fim])}` };
}

/** Consulta da API: as marcas escolhidas e a origem desta página nos links de volta. */
export function consultaDaExportacao(marcas: PreferenciasDoObsidian['marcas'], origem: string): string {
  return `marcas=${marcas}&base=${encodeURIComponent(origem)}`;
}

/** Nome do arquivo no `Content-Disposition` (o `filename*` em UTF-8, senão o `filename`). */
export function arquivoDoCabecalho(cabecalho: string | null, padrao: string): string {
  if (cabecalho === null) return padrao;
  const estendido = /filename\*=UTF-8''([^;]+)/i.exec(cabecalho)?.[1];
  if (estendido !== undefined) {
    try { return decodeURIComponent(estendido); } catch { /* cai no simples */ }
  }
  return /filename="([^"]+)"/i.exec(cabecalho)?.[1] ?? padrao;
}

export async function baixarNota(documentoId: string, marcas: PreferenciasDoObsidian['marcas'], origem: string): Promise<{ arquivo: string; conteudo: string }> {
  const resposta = await fetch(`/api/documentos/${documentoId}/obsidian.md?${consultaDaExportacao(marcas, origem)}`);
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null) as { detalhe?: string } | null;
    throw new Error(corpo?.detalhe ?? 'Não foi possível gerar a nota.');
  }
  return { arquivo: arquivoDoCabecalho(resposta.headers.get('content-disposition'), 'Margem.md'), conteudo: await resposta.text() };
}
