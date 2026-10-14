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
/**
 * V-T3: não há mais níveis de atenção. Todas as marcas aparecem juntas, ou nenhuma: a opção "Mostrar
 * todas as marcas ao abrir" (Configurações) decide como o leitor abre, e o botão "Marcas" da barra as
 * mostra ou esconde. A saliência continua nos dados (contrato e banco), fora da tela e do filtro.
 */
export function marcasVisiveis(marcas: readonly MarcaDoLeitor[], visiveis: boolean): MarcaDoLeitor[] {
  return visiveis ? [...marcas] : [];
}

/** Como uma marca pesa no desenho: todas iguais (a saliência não muda mais o traço; V-T3). */
export interface PesoDaSaliencia { fator: number; soSublinhado: boolean; espessura: number }
const PESO_UNICO: PesoDaSaliencia = { fator: 1, soSublinhado: false, espessura: 1.5 };
export function pesoDaSaliencia(marca: MarcaDoLeitor): PesoDaSaliencia {
  void marca;
  return PESO_UNICO;
}
/**
 * "Primeiro eu": as marcas da IA esperam o primeiro gesto do leitor no capítulo. Vale um grifo seu
 * (a nota agora é sempre de um grifo) ou uma anotação antiga, de antes de a nota ir para o grifo.
 */
export function liberarPrimeiroEu(ativo: boolean, anotacoes: readonly AnotacaoV1[], blocos: readonly { id: string }[],
  marcas: readonly Pick<MarcaDoLeitor, 'origem' | 'ancora'>[] = []): boolean {
  const noCapitulo = (ancora: AncoraV1) => blocos.some((b) => b.id === ancora.bloco_id);
  return !ativo || anotacoes.some((a) => noCapitulo(a.ancora)) || marcas.some((m) => m.origem === 'manual' && noCapitulo(m.ancora));
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
 * das contagens, no leitor e na biblioteca (`servico/src/http/consultas.ts`, J107), com as marcas à vista ou não.
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
