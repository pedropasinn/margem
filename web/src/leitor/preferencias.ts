export const CORES_DO_METODO = { tese: '#ffd926', conceito: '#59d675', justificativa: '#52abff' };
export const CORES_DE_CONTRASTE = { tese: '#e8b000', conceito: '#009e73', justificativa: '#0072b2' };
export interface Preferencias {
  zoomPdf: 'largura' | number;
  /** O leitor abre com todas as marcas à vista (padrão) ou com elas ocultas, à espera do botão "Marcas". */
  marcasAoAbrir: boolean;
  coresPersonalizadas: Record<string, string>;
  /** Grifo: faixa com a linha de base; marca-texto: só a faixa; sublinhado: só a linha. */
  estilo: 'grifo' | 'marca_texto' | 'sublinhado' | 'margem';
  intensidade: number;
  /** Régua: faixas e linhas retas, alinhadas ao texto. À mão: o traço irregular, ajustado pela rugosidade. */
  traco: 'regua' | 'mao';
  rugosidade: number;
  animacao: boolean;
  cores: typeof CORES_DO_METODO;
  /** Tamanho da letra do texto, de 16 a 32 px (o padrão da UI editorial é 22). */
  tamanho: number;
  /** Prosa justificada e hifenizada (padrão) ou alinhada à esquerda, sem hifenização. */
  alinhamento: 'justificado' | 'esquerda';
  /** Espaço entre letras e palavras: normal, amplo ou máximo (ajuda a leitura com dislexia). */
  espacamento: 'normal' | 'amplo' | 'maximo';
  /** Atalhos de uma tecla (H, N, M, [, ]…); desligados, só valem os com Ctrl, ⌘ ou Alt (WCAG 2.1.4). */
  atalhosDeLetra: boolean;
  entrelinha: 'compacta' | 'normal' | 'folgada';
  medida: 65 | 68 | 70;
  tema: 'sistema' | 'claro' | 'escuro' | 'sepia';
  margem: 'mostrar' | 'recolher';
}
export const APARENCIA_PADRAO: Preferencias = {
  zoomPdf: 'largura', marcasAoAbrir: true, coresPersonalizadas: {},
  estilo: 'grifo', intensidade: .3, traco: 'regua', rugosidade: .55, animacao: true,
  cores: CORES_DO_METODO, tamanho: 22, entrelinha: 'normal', medida: 68, tema: 'sistema', margem: 'recolher',
  alinhamento: 'justificado', espacamento: 'normal', atalhosDeLetra: true,
};
export const TAMANHO_MINIMO = 16;
export const TAMANHO_MAXIMO = 32;
/** A rugosidade que o traço usa de fato: zero na régua. */
export function rugosidadeDoTraco(preferencias: Pick<Preferencias, 'traco' | 'rugosidade'>): number {
  return preferencias.traco === 'regua' ? 0 : preferencias.rugosidade;
}
/** Sobe quando um padrão muda e deve valer também para quem já tinha preferências guardadas. */
const VERSAO_DAS_PREFERENCIAS = 3;
export type MudancaDeAparencia = { tipo: 'alterar'; valores: Partial<Preferencias> } | { tipo: 'restaurar' };

/** Reconstrói apenas campos conhecidos; dados antigos ou inválidos não entram no CSS. */
export function validarPreferencias(valor: unknown): Preferencias {
  if (typeof valor !== 'object' || valor === null) return { ...APARENCIA_PADRAO };
  const v = valor as Record<string, unknown>;
  const escolher = <T extends string | number>(chave: string, permitidos: readonly T[], padrao: T): T =>
    permitidos.includes(v[chave] as T) ? v[chave] as T : padrao;
  const limitado = (chave: string, padrao: number): number =>
    typeof v[chave] === 'number' && Number.isFinite(v[chave]) ? Math.min(1, Math.max(0, v[chave])) : padrao;
  const cores = { ...CORES_DO_METODO };
  if (typeof v['cores'] === 'object' && v['cores'] !== null) {
    const recebidas = v['cores'] as Record<string, unknown>;
    for (const funcao of Object.keys(cores) as (keyof typeof cores)[]) {
      const cor = recebidas[funcao];
      if (typeof cor === 'string' && /^#[\da-f]{6}$/i.test(cor)) cores[funcao] = cor;
    }
  }
  const coresPersonalizadas: Record<string, string> = {};
  if (typeof v['coresPersonalizadas'] === 'object' && v['coresPersonalizadas'] !== null) {
    for (const [chave, cor] of Object.entries(v['coresPersonalizadas'])) {
      if (/^[a-z][a-z0-9_]*$/.test(chave) && typeof cor === 'string' && /^#[\da-f]{6}$/i.test(cor)) coresPersonalizadas[chave] = cor;
    }
  }
  return {
    zoomPdf: typeof v['zoomPdf'] === 'number' && Number.isFinite(v['zoomPdf']) ? Math.max(.25, Math.min(3, v['zoomPdf'])) : 'largura',
    // O antigo nível de atenção (0 a 3) não vale mais: todas as marcas, salvo a escolha explícita de abrir sem elas.
    marcasAoAbrir: typeof v['marcasAoAbrir'] === 'boolean' ? v['marcasAoAbrir'] : true, coresPersonalizadas,
    // Na versão 3 o grifo virou o padrão: o que foi guardado antes dela com o marca-texto (o padrão de então)
    // passa para o grifo. Sem versão é o estado em memória, já atual.
    estilo: typeof v['versao'] === 'number' && v['versao'] < 3 && v['estilo'] === 'marca_texto' ? 'grifo'
      : escolher('estilo', ['grifo', 'marca_texto', 'sublinhado', 'margem'], 'grifo'),
    intensidade: limitado('intensidade', .3), traco: escolher('traco', ['regua', 'mao'], 'regua'), rugosidade: limitado('rugosidade', .55),
    animacao: typeof v['animacao'] === 'boolean' ? v['animacao'] : true, cores,
    tamanho: typeof v['tamanho'] === 'number' && Number.isInteger(v['tamanho']) && v['tamanho'] >= TAMANHO_MINIMO && v['tamanho'] <= TAMANHO_MAXIMO ? v['tamanho'] : 22,
    alinhamento: escolher('alinhamento', ['justificado', 'esquerda'], 'justificado'),
    espacamento: escolher('espacamento', ['normal', 'amplo', 'maximo'], 'normal'),
    atalhosDeLetra: typeof v['atalhosDeLetra'] === 'boolean' ? v['atalhosDeLetra'] : true,
    entrelinha: escolher('entrelinha', ['compacta', 'normal', 'folgada'], 'normal'),
    medida: escolher('medida', [65, 68, 70], 68),
    tema: escolher('tema', ['sistema', 'claro', 'escuro', 'sepia'], 'sistema'),
    // Antes da versão 2 o padrão era mostrar as notas inteiras; o que foi guardado então passa a abrir recolhido.
    // Sem versão é o estado em memória (a escolha que o leitor acabou de fazer).
    margem: typeof v['versao'] === 'number' && v['versao'] < 2 ? 'recolher' : escolher('margem', ['mostrar', 'recolher'], 'recolher'),
  };
}
export function reduzirPreferencias(estado: Preferencias, acao: MudancaDeAparencia): Preferencias {
  return acao.tipo === 'restaurar' ? { ...APARENCIA_PADRAO } : validarPreferencias({ ...estado, ...acao.valores });
}
export function lerPreferencias(): Preferencias {
  try {
    const guardado: unknown = JSON.parse(localStorage.getItem('margem:aparencia') ?? 'null');
    // O que foi guardado antes de haver versão conta como a versão 1; sem versão, só o estado em memória.
    const comVersao = typeof guardado === 'object' && guardado !== null && typeof (guardado as { versao?: unknown }).versao !== 'number'
      ? { ...guardado, versao: 1 } : guardado;
    return validarPreferencias(comVersao);
  }
  catch { return { ...APARENCIA_PADRAO }; }
}
export function guardarPreferencias(preferencias: Preferencias): void {
  try { localStorage.setItem('margem:aparencia', JSON.stringify({ ...preferencias, versao: VERSAO_DAS_PREFERENCIAS })); } catch { /* Funciona sem storage. */ }
}
