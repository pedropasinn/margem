/**
 * Roteamento mínimo por `history`, sem biblioteca externa.
 *
 * Início, biblioteca com filtros, adição, documento, notas, leitura de um capítulo e quadro.
 * O caminho é a verdade; o estado do React só o acompanha.
 */
import { useCallback, useEffect, useState } from 'react';

export type Rota =
  | { nome: 'noticias'; edicao_id?: string }
  | { nome: 'inicio' }
  | { nome: 'biblioteca'; tipo?: TipoDaBiblioteca; aba?: 'todos' | 'lendo' | 'novos' | 'arquivados'; buscar?: boolean }
  | { nome: 'adicionar'; entrada?: 'colado' }
  | { nome: 'primeiros-passos' }
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
  /** Configurações da instalação; hoje, o áudio com a chave da ElevenLabs (J106). */
  | { nome: 'configuracoes' };

export type PaginaDeAjuda = 'instalar' | 'extensao' | 'obsidian';
const PAGINAS_DE_AJUDA: readonly PaginaDeAjuda[] = ['instalar', 'extensao', 'obsidian'];

export type TipoDaBiblioteca = 'livros' | 'textos' | 'pdfs' | 'videos' | 'quadros';
export const TIPOS_DA_BIBLIOTECA: readonly TipoDaBiblioteca[] = ['livros', 'textos', 'pdfs', 'videos', 'quadros'];
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
  if (partes[0] === 'adicionar') return parametros.get('entrada') === 'colado' ? { nome: 'adicionar', entrada: 'colado' } : { nome: 'adicionar' };
  if (partes[0] === 'primeiros-passos') return { nome: 'primeiros-passos' };
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
    case 'adicionar': return rota.entrada === 'colado' ? '/adicionar?entrada=colado' : '/adicionar';
    case 'primeiros-passos': return '/primeiros-passos';
    case 'configuracoes': return '/configuracoes';
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

export interface Navegacao {
  rota: Rota;
  ir: (destino: Rota, substituir?: boolean) => void;
}

export function usarRota(): Navegacao {
  const [rota, definir] = useState<Rota>(() => rotaDoCaminho(window.location.pathname + window.location.search));
  useEffect(() => {
    const aoVoltar = () => { definir(rotaDoCaminho(window.location.pathname + window.location.search)); };
    window.addEventListener('popstate', aoVoltar);
    return () => { window.removeEventListener('popstate', aoVoltar); };
  }, []);
  const ir = useCallback((destino: Rota, substituir = false) => {
    const caminho = caminhoDaRota(destino);
    if (substituir) window.history.replaceState(null, '', caminho);
    else window.history.pushState(null, '', caminho);
    definir(destino);
  }, []);
  return { rota, ir };
}
