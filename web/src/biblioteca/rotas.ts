/**
 * Roteamento mínimo por `history`, sem biblioteca externa.
 *
 * Início, biblioteca com filtros, adição, documento, notas, leitura de um capítulo e quadro.
 * O caminho é a verdade; o estado do React só o acompanha.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Rota =
  | { nome: 'noticias'; edicao_id?: string }
  | { nome: 'inicio' }
  | { nome: 'biblioteca'; tipo?: TipoDaBiblioteca; aba?: 'todos' | 'lendo' | 'novos' | 'arquivados'; buscar?: boolean }
  /** Adicionar por aba (V-D2); sem aba, a última usada. `modo: 'colar'` abre o Documento no campo de colar. */
  | { nome: 'adicionar'; aba?: AbaDeAdicionar; modo?: 'colar' }
  | { nome: 'ajuda'; pagina: PaginaDeAjuda }
  | { nome: 'documento'; documento_id: string }
  | { nome: 'notas'; documento_id?: string }
  | { nome: 'exercicios'; documento_id: string }
  /** Flashcards da biblioteca ou de um documento: a fila do dia (`estudar`) ou a lista (`todos`). */
  | { nome: 'flashcards'; documento_id?: string; aba?: 'todos' }
  /** `bloco`: abre o capítulo já no trecho (`?bloco=`), como fazem a busca e o link de volta do export. */
  | { nome: 'leitura'; documento_id: string; secao_id?: string; bloco?: string }
  | { nome: 'salas' }
  | { nome: 'nova-sala' }
  | { nome: 'sala'; sala_id: string; aba?: 'editar' }
  | { nome: 'quadro'; slug: string }
  /** Página "Perguntar": o agente com acesso à biblioteca inteira; `conversa_id` abre um fio. */
  | { nome: 'perguntar'; conversa_id?: string }
  /** Configurações: a preparação e o áudio (J106) e, como seção própria, os Primeiros passos (V-T1). */
  | { nome: 'configuracoes'; secao?: SecaoDasConfiguracoes };

export type SecaoDasConfiguracoes = 'primeiros-passos';

export type AbaDeAdicionar = 'documento' | 'video' | 'quadro';
export const ABAS_DE_ADICIONAR: readonly AbaDeAdicionar[] = ['documento', 'video', 'quadro'];
const ehAbaDeAdicionar = (valor: string | undefined): valor is AbaDeAdicionar => (ABAS_DE_ADICIONAR as readonly (string | undefined)[]).includes(valor);

export type PaginaDeAjuda = 'instalar' | 'extensao' | 'obsidian';
const PAGINAS_DE_AJUDA: readonly PaginaDeAjuda[] = ['instalar', 'extensao', 'obsidian'];

/** Categorias pelo tipo de arquivo (V-D1); o antigo `?tipo=livros` cai em "Todos". */
export type TipoDaBiblioteca = 'pdfs' | 'epubs' | 'textos' | 'markdowns' | 'videos' | 'quadros';
export const TIPOS_DA_BIBLIOTECA: readonly TipoDaBiblioteca[] = ['pdfs', 'epubs', 'textos', 'markdowns', 'videos', 'quadros'];
export const ehTipoDaBiblioteca = (valor: string | null): valor is TipoDaBiblioteca => (TIPOS_DA_BIBLIOTECA as readonly (string | null)[]).includes(valor);

export function rotaDoCaminho(caminho: string): Rota {
  const [trilha = '', consulta] = caminho.split('?');
  const parametros = new URLSearchParams(consulta);
  if (trilha === '/biblioteca') {
    const tipo = parametros.get('tipo');
    const aba = parametros.get('aba');
    return { nome: 'biblioteca',
      ...(ehTipoDaBiblioteca(tipo) ? { tipo } : {}),
      ...(aba === 'todos' || aba === 'lendo' || aba === 'novos' || aba === 'arquivados' ? { aba } : {}),
    };
  }
  const partes = trilha.split('/').filter((parte) => parte !== '');
  if (partes[0] === 'noticias') return partes[1] && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(partes[1]) ? { nome: 'noticias', edicao_id: partes[1] } : { nome: 'noticias' };
  if (partes[0] === 'salas') {
    if (partes[1] === undefined) return { nome: 'salas' };
    if (partes[1] === 'nova') return { nome: 'nova-sala' };
    return partes[2] === 'editar' ? { nome: 'sala', sala_id: partes[1], aba: 'editar' } : { nome: 'sala', sala_id: partes[1] };
  }
  if (partes[0] === 'notas') return { nome: 'notas' };
  if (partes[0] === 'flashcards') return parametros.get('aba') === 'todos' ? { nome: 'flashcards', aba: 'todos' } : { nome: 'flashcards' };
  if (partes[0] === 'documentos' && partes[1] !== undefined && partes[2] === 'flashcards') {
    return parametros.get('aba') === 'todos' ? { nome: 'flashcards', documento_id: partes[1], aba: 'todos' } : { nome: 'flashcards', documento_id: partes[1] };
  }
  if (partes[0] === 'perguntar') return partes[1] !== undefined && /^[0-9A-HJKMNP-TV-Z]{26}$/u.test(partes[1]) ? { nome: 'perguntar', conversa_id: partes[1] } : { nome: 'perguntar' };
  if (partes[0] === 'documentos' && partes[1] !== undefined && partes[2] === 'notas') return { nome: 'notas', documento_id: partes[1] };
  if (partes[0] === 'documentos' && partes[1] !== undefined && partes[2] === 'exercicios') return { nome: 'exercicios', documento_id: partes[1] };
  if (partes[0] === 'adicionar') {
    // `?entrada=colado` é o endereço antigo do texto colado: vira a aba Documento no campo de colar.
    if (parametros.get('entrada') === 'colado') return { nome: 'adicionar', aba: 'documento', modo: 'colar' };
    if (!ehAbaDeAdicionar(partes[1])) return { nome: 'adicionar' };
    return partes[1] === 'documento' && parametros.get('modo') === 'colar' ? { nome: 'adicionar', aba: 'documento', modo: 'colar' } : { nome: 'adicionar', aba: partes[1] };
  }
  // Os Primeiros passos moram nas Configurações; o endereço antigo (`/primeiros-passos`) leva até lá.
  if (partes[0] === 'primeiros-passos' || (partes[0] === 'configuracoes' && partes[1] === 'primeiros-passos')) return { nome: 'configuracoes', secao: 'primeiros-passos' };
  if (partes[0] === 'configuracoes') return { nome: 'configuracoes' };
  if (partes[0] === 'ajuda' && PAGINAS_DE_AJUDA.includes(partes[1] as PaginaDeAjuda)) return { nome: 'ajuda', pagina: partes[1] as PaginaDeAjuda };
  // Quadros (acervo de arte): `/quadros/<slug>` abre o quadro; `/quadros` e o antigo `/arte` são a lista.
  if ((partes[0] === 'quadros' || partes[0] === 'arte') && partes[1] !== undefined && /^[a-z0-9][a-z0-9-]*$/.test(partes[1])) return { nome: 'quadro', slug: partes[1] };
  if (partes[0] === 'quadros' || partes[0] === 'arte') return { nome: 'biblioteca', tipo: 'quadros' };
  if (partes[0] === 'documentos' && partes[1] !== undefined) {
    return { nome: 'documento', documento_id: partes[1] };
  }
  if (partes[0] === 'ler' && partes[1] !== undefined) {
    const bloco = partes[2] === undefined ? null : parametros.get('bloco');
    return partes[2] === undefined
      ? { nome: 'leitura', documento_id: partes[1] }
      : { nome: 'leitura', documento_id: partes[1], secao_id: partes[2], ...(bloco ? { bloco } : {}) };
  }
  return { nome: 'inicio' };
}

export function caminhoDaRota(rota: Rota): string {
  switch (rota.nome) {
    case 'noticias': return rota.edicao_id ? `/noticias/${rota.edicao_id}` : '/noticias';
    case 'biblioteca': {
      const parametros = new URLSearchParams();
      if (rota.tipo) parametros.set('tipo', rota.tipo);
      if (rota.aba) parametros.set('aba', rota.aba);
      return `/biblioteca${parametros.size ? `?${parametros}` : ''}`;
    }
    case 'adicionar': return rota.aba === undefined ? '/adicionar' : `/adicionar/${rota.aba}${rota.modo === 'colar' ? '?modo=colar' : ''}`;
    case 'configuracoes': return rota.secao === undefined ? '/configuracoes' : `/configuracoes/${rota.secao}`;
    case 'ajuda': return `/ajuda/${rota.pagina}`;
    case 'quadro': return `/quadros/${rota.slug}`;
    case 'perguntar': return rota.conversa_id === undefined ? '/perguntar' : `/perguntar/${rota.conversa_id}`;
    case 'documento': return `/documentos/${rota.documento_id}`;
    case 'notas': return rota.documento_id === undefined ? '/notas' : `/documentos/${rota.documento_id}/notas`;
    case 'exercicios': return `/documentos/${rota.documento_id}/exercicios`;
    case 'flashcards': return `${rota.documento_id === undefined ? '/flashcards' : `/documentos/${rota.documento_id}/flashcards`}${rota.aba ? '?aba=todos' : ''}`;
    case 'salas': return '/salas';
    case 'nova-sala': return '/salas/nova';
    case 'sala': return rota.aba === 'editar' ? `/salas/${rota.sala_id}/editar` : `/salas/${rota.sala_id}`;
    case 'leitura': return rota.secao_id === undefined
      ? `/ler/${rota.documento_id}`
      : `/ler/${rota.documento_id}/${rota.secao_id}${rota.bloco ? `?bloco=${encodeURIComponent(rota.bloco)}` : ''}`;
    default: return '/';
  }
}

/**
 * O caminho canônico de um endereço antigo (`/biblioteca?tipo=livros`, `/arte`, `/adicionar?entrada=colado`, `/primeiros-passos`), para
 * trocar a barra de endereço sem criar entrada no histórico; `null` quando o endereço já é o canônico.
 */
export function caminhoCanonico(caminho: string): string | null {
  const rota = rotaDoCaminho(caminho);
  if (rota.nome !== 'biblioteca' && rota.nome !== 'adicionar' && rota.nome !== 'configuracoes') return null;
  const canonico = caminhoDaRota(rota);
  return canonico === caminho ? null : canonico;
}

export interface Navegacao {
  rota: Rota;
  ir: (destino: Rota, substituir?: boolean) => void;
}

/**
 * Uma tela pode segurar a saída (U-02: Adicionar com envio pendente). A guarda recebe o destino e a
 * função que segue para ele; devolve `true` quando segurou (e chama `seguir` se a pessoa confirmar).
 */
export type GuardaDeSaida = (destino: Rota, seguir: () => void) => boolean;
let guardaDeSaida: GuardaDeSaida | null = null;

/** Instala a guarda; devolve a função que a retira (só se ainda for a mesma). */
export function segurarSaida(guarda: GuardaDeSaida): () => void {
  guardaDeSaida = guarda;
  return () => { if (guardaDeSaida === guarda) guardaDeSaida = null; };
}

export function usarRota(): Navegacao {
  const [rota, definir] = useState<Rota>(() => rotaDoCaminho(window.location.pathname + window.location.search));
  const atual = useRef(rota); atual.current = rota;
  useEffect(() => {
    const canonico = caminhoCanonico(window.location.pathname + window.location.search);
    if (canonico !== null) window.history.replaceState(null, '', canonico);
  }, [rota]);
  useEffect(() => {
    const aoVoltar = () => {
      const caminho = window.location.pathname + window.location.search;
      const destino = rotaDoCaminho(caminho);
      // Voltar do navegador com a saída segura: o endereço volta ao da tela, e só muda se a pessoa confirmar.
      if (guardaDeSaida !== null) {
        window.history.pushState(null, '', caminhoDaRota(atual.current));
        if (guardaDeSaida(destino, () => { window.history.replaceState(null, '', caminho); definir(destino); })) return;
        window.history.replaceState(null, '', caminho);
      }
      definir(destino);
    };
    window.addEventListener('popstate', aoVoltar);
    return () => { window.removeEventListener('popstate', aoVoltar); };
  }, []);
  const ir = useCallback((destino: Rota, substituir = false) => {
    const seguir = () => {
      const caminho = caminhoDaRota(destino);
      if (substituir) window.history.replaceState(null, '', caminho);
      else window.history.pushState(null, '', caminho);
      definir(destino);
    };
    if (guardaDeSaida?.(destino, seguir)) return;
    seguir();
  }, []);
  return { rota, ir };
}
