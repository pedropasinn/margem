import type { AncoraV1, AnotacaoV1, ConversaV2, MarcaV1, MarcaV2, ModoDeLeituraV1, ReferenciaModo } from '@margem/contratos';
import type { Preferencias } from './preferencias';

/** A projeção aceita snapshots antigos e novos, sem alterar os contratos. */
export type MarcaDoLeitor = MarcaV1 | MarcaV2;
export interface CamadaResumida {
  id: string; tipo: 'execucao' | 'importacao'; modo: ReferenciaModo; criada_em: string; marcas: number;
  /** Camada da compreensão do capítulo (J29); ausente nas respostas antigas. */
  compreensao?: boolean;
  /** Rótulo cego da comparação (J32): quando existe, é o único nome mostrado. */
  rotulo?: string | null;
}
export interface ResumoConversa { id: string; ancora: AncoraV1; estado: ConversaV2['estado']; criada_em: string; mensagens: number; ultima: ConversaV2['mensagens'][number] | null }
export interface TracoPessoal {
  id: string; ancora: AncoraV1; acao: 'sublinhado' | 'caixa';
  /** Dificuldade textual da compreensão (nível 3): sublinhado tracejado, na cor de aviso. */
  dificuldade?: boolean;
}
export type NivelDeAtencao = 0 | 1 | 2 | 3;
export function reduzirAtencao(_estado: NivelDeAtencao, valor: number): NivelDeAtencao {
  return [0, 1, 2, 3].includes(valor) ? valor as NivelDeAtencao : _estado;
}
export function filtrarSaliencia(marcas: readonly MarcaDoLeitor[], nivel: NivelDeAtencao): MarcaDoLeitor[] {
  // Os grifos do leitor (J37) aparecem em qualquer nível com marcas; só o "Texto puro" os esconde.
  return nivel === 0 ? [] : marcas.filter((m) => m.origem === 'manual' || ('saliencia' in m ? m.saliencia : 2) <= nivel);
}
/** O que cada nível de atenção é para quem lê: o nome aparece na barra e na dica dos pontos. */
export const NOMES_DOS_NIVEIS = ['Texto puro', 'Esqueleto', 'Estudo', 'Aprofundar'] as const;
/** "Estudo · 9 marcas", "Aprofundar · 9 marcas · 3 dificuldades · sublinhado = periférico": o que o nível mostra antes do clique. */
export function dicaDoNivel(nivel: NivelDeAtencao, marcas: number, dificuldades = 0): string {
  const nome = NOMES_DOS_NIVEIS[nivel];
  if (nivel === 0) return `${nome} · sem marcas`;
  const partes = [nome, `${String(marcas)} ${marcas === 1 ? 'marca' : 'marcas'}`];
  if (nivel === 3 && dificuldades > 0) partes.push(`${String(dificuldades)} ${dificuldades === 1 ? 'dificuldade' : 'dificuldades'}`);
  // Legenda do único traço que o nível 3 acrescenta: o sublinhado (e o círculo tracejado) é o periférico.
  if (nivel === 3) partes.push('sublinhado = periférico');
  return partes.join(' · ');
}

/**
 * Como a saliência pesa no desenho: 1 é o marca-texto cheio, 2 o mesmo traço mais claro e 3 só um
 * sublinhado fino. Assim o nível 3 acrescenta detalhe sem apagar o esqueleto. Marca sem saliência
 * (leitura de F1) desenha como 1.
 */
export interface PesoDaSaliencia { saliencia: 1 | 2 | 3; fator: number; soSublinhado: boolean; espessura: number }
export function pesoDaSaliencia(marca: MarcaDoLeitor): PesoDaSaliencia {
  const saliencia = 'saliencia' in marca ? marca.saliencia : 1;
  if (saliencia === 3) return { saliencia, fator: .8, soSublinhado: true, espessura: 1 };
  if (saliencia === 2) return { saliencia, fator: .55, soSublinhado: false, espessura: 1.5 };
  return { saliencia: 1, fator: 1, soSublinhado: false, espessura: 1.5 };
}
export function liberarPrimeiroEu(ativo: boolean, anotacoes: readonly AnotacaoV1[], blocos: readonly { id: string }[]): boolean {
  return !ativo || anotacoes.some((a) => blocos.some((b) => b.id === a.ancora.bloco_id));
}
export function rotuloCamada(camada: CamadaResumida): string {
  const data = new Date(camada.criada_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (camada.rotulo) return camada.rotulo;
  const modo = camada.modo.id.replaceAll('_', ' ');
  const nome = modo === 'literaria' ? 'literária' : modo;
  if (camada.compreensao) return `Compreensão ${nome} · ${data}`;
  return camada.tipo === 'importacao' ? `Importação · ${modo} · ${data}` : `Leitura ${nome} · ${data}`;
}
/** A cor do grifo do leitor sem função: um cinza neutro, para ele ter um identificador (J37). */
export const COR_SEM_FUNCAO = { claro: '#a3a8b3', escuro: '#8a909c' };
/** Só se desenha a marca com função, ou o grifo do leitor (com qualquer função, inclusive nenhuma). */
export function desenhaMarca(marca: Pick<MarcaDoLeitor, 'funcao' | 'origem'>): boolean {
  return marca.funcao !== 'nenhuma' || marca.origem === 'manual';
}
/**
 * A marca que o texto desenha: visível, resolvida, não rejeitada e com cor (ou grifo do leitor). É o recorte
 * das contagens, no leitor e na biblioteca (`servico/src/http/consultas.ts`, J107), em qualquer nível de atenção.
 */
export function grifoNoTexto(marca: Pick<MarcaDoLeitor, 'funcao' | 'origem' | 'visivel' | 'validade' | 'avaliacao'>): boolean {
  return marca.visivel && marca.validade === 'resolvida' && marca.avaliacao !== 'rejeitada' && desenhaMarca(marca);
}
/**
 * O número da nota: o anel na cor da função; o algarismo, a mesma cor misturada ao texto, para passar
 * de 4,5:1 (WCAG AA) sem perder o tom do método. A proporção é por tema (`--mistura-do-numero`, em
 * `ui/tokens.css`); sobre a página do PDF, sempre branca, a tinta é o preto (`--tinta-dos-numeros`).
 */
export function estiloDoNumero(cor: string): { borderColor: string; color: string } {
  return { borderColor: cor, color: `color-mix(in srgb, ${cor} var(--mistura-do-numero, 50%), var(--tinta-dos-numeros, var(--texto-1, #000)))` };
}
export function corDaFuncao(chave: string, modo: ReferenciaModo | undefined, modos: readonly ModoDeLeituraV1[], p: Preferencias, escuro: boolean): string {
  const sobrescrita = p.coresPersonalizadas[chave];
  if (sobrescrita) return sobrescrita;
  if (chave === 'nenhuma') return COR_SEM_FUNCAO[escuro ? 'escuro' : 'claro'];
  const funcao = modos.find((m) => m.id === modo?.id && m.revisao === modo.revisao)?.funcoes.find((f) => f.chave === chave);
  return funcao?.cor[escuro ? 'escuro' : 'claro'] ?? p.cores[chave as keyof typeof p.cores] ?? 'var(--texto-1)';
}
export interface EstadoConversa { id: string | null; conversa: ConversaV2 | null; pendentes: { mensagem_id: string; job_id: string | null; estado: string | null }[]; erro: string | null }
export type AcaoConversa = { tipo: 'abrir'; id: string } | { tipo: 'receber'; id: string; conversa: ConversaV2; pendentes: EstadoConversa['pendentes'] } | { tipo: 'erro'; id: string; erro: string } | { tipo: 'fechar' };
export const CONVERSA_VAZIA: EstadoConversa = { id: null, conversa: null, pendentes: [], erro: null };
export function reduzirConversa(estado: EstadoConversa, acao: AcaoConversa): EstadoConversa {
  if (acao.tipo === 'fechar') return CONVERSA_VAZIA;
  if (acao.tipo === 'abrir') return { ...CONVERSA_VAZIA, id: acao.id };
  if (acao.id !== estado.id) return estado;
  if (acao.tipo === 'erro') return { ...estado, erro: acao.erro };
  return { id: acao.id, conversa: acao.conversa, pendentes: acao.pendentes, erro: null };
}
