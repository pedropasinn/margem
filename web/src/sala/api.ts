/**
 * Cliente da sala de teste. O testador fala com o portão (`/api/salas/publico/<slug>/…` e a lista
 * de rotas de leitura); o dono fala com a API principal (`/api/salas…`). Os dois usam `pedir`,
 * que manda o `X-Margem` nas escritas.
 */
import type {
  ComentarioDaSalaV1, FormularioDaSalaV1, Id, RespostaDaSalaV1, SalaDeTesteV1, ValorDaRespostaDaSala,
} from '@margem/contratos';
import { escrever, pedir } from '../biblioteca/api';

// ---------------------------------------------------------------- testador (portão)

export interface SalaPublica { titulo: string; aberta: boolean }
export interface DocumentoDaSala { id: Id; titulo: string; autor: string | null; formato: string; versao_id: Id; capitulos: number; comentarios: number }
export interface CapaDaSala {
  sala: { titulo: string; boas_vindas: string; expira_em: string | null; formulario: FormularioDaSalaV1 };
  testador: { nome: string };
  documentos: DocumentoDaSala[];
  resposta: RespostaDaSalaV1 | null;
}
export interface RespostasDoFormulario { geral: Record<string, ValorDaRespostaDaSala>; por_documento: Record<Id, Record<string, ValorDaRespostaDaSala>> }

const base = (slug: string) => `/api/salas/publico/${encodeURIComponent(slug)}`;

export const salaPublica = (slug: string) => pedir<{ sala: SalaPublica; dentro: boolean }>(base(slug));
export const entrarNaSala = (slug: string, dados: { nome: string; email?: string; senha: string }) =>
  escrever<{ sala: SalaPublica; testador: { nome: string }; expira_em: string }>(`${base(slug)}/entrar`, dados);
export const sairDaSala = (slug: string) => escrever<{ saiu: boolean }>(`${base(slug)}/sair`, {});
export const capaDaSala = (slug: string) => pedir<CapaDaSala>(`${base(slug)}/capa`);
export const comentariosDaSala = (slug: string, documento: Id) =>
  pedir<{ comentarios: ComentarioDaSalaV1[] }>(`${base(slug)}/comentarios?documento=${encodeURIComponent(documento)}`);
export const comentarNaSala = (slug: string, pedido: Pick<ComentarioDaSalaV1, 'versao_id' | 'bloco_id' | 'inicio_utf16' | 'fim_utf16' | 'citacao' | 'texto'>) =>
  escrever<{ comentario: ComentarioDaSalaV1 }>(`${base(slug)}/comentarios`, pedido);
export const apagarComentarioDaSala = (slug: string, id: Id) => pedir<unknown>(`${base(slug)}/comentarios/${id}`, { method: 'DELETE' });
export const gravarRespostas = (slug: string, respostas: RespostasDoFormulario, enviar: boolean) =>
  escrever<{ resposta: RespostaDaSalaV1 }>(`${base(slug)}/respostas`, { ...respostas, enviar }, 'PUT');

// ---------------------------------------------------------------- dono (API principal)

export interface PortaoConfigurado { url: string; configurada: boolean }
export interface ResumoDaSala extends SalaDeTesteV1 { testadores: number; enviadas: number; comentarios: number }
export interface MediaDaPergunta { media: number | null; respostas: number }
export interface TestadorNoRelatorio {
  id: Id; nome: string; email: string | null; criado_em: string; ultimo_acesso_em: string; comentarios: number; resposta: RespostaDaSalaV1 | null;
}
export interface ComentarioNoRelatorio extends ComentarioDaSalaV1 { testador: string; documento_titulo: string; secao_id: Id | null }
export interface RelatorioDaSala {
  sala: SalaDeTesteV1;
  documentos: { id: Id; titulo: string }[];
  testadores: TestadorNoRelatorio[];
  medias: { geral: Record<string, MediaDaPergunta>; por_documento: Record<Id, Record<string, MediaDaPergunta>> };
  escolhas: { geral: Record<string, Record<string, number>>; por_documento: Record<Id, Record<string, Record<string, number>>> };
  comentarios: ComentarioNoRelatorio[];
}
export interface DadosDaSala {
  titulo: string; boas_vindas: string; documentos: Id[]; ativa: boolean; expira_em: string | null; formulario: FormularioDaSalaV1;
}

export const listarSalas = () => pedir<{ salas: ResumoDaSala[]; portao: PortaoConfigurado }>('/api/salas');
export const obterSala = (id: Id) => pedir<{ sala: SalaDeTesteV1; portao: PortaoConfigurado }>(`/api/salas/${id}`);
export const criarSala = (dados: DadosDaSala & { senha?: string }) =>
  escrever<{ sala: SalaDeTesteV1; senha: string; senha_gerada: boolean; portao: PortaoConfigurado }>('/api/salas', dados);
export const mudarSala = (id: Id, mudanca: Partial<DadosDaSala>) => escrever<{ sala: SalaDeTesteV1 }>(`/api/salas/${id}`, mudanca, 'PATCH');
export const trocarSenhaDaSala = (id: Id, senha?: string) => escrever<{ senha: string; senha_gerada: boolean }>(`/api/salas/${id}/senha`, senha ? { senha } : {});
export const apagarSala = (id: Id) => pedir<unknown>(`/api/salas/${id}`, { method: 'DELETE' });
export const relatorioDaSala = (id: Id) => pedir<RelatorioDaSala>(`/api/salas/${id}/respostas`);
export const csvDaSala = (id: Id, tipo: 'respostas' | 'comentarios') => `/api/salas/${id}/${tipo}.csv`;

/** O link da sala e a mensagem pronta (a senha vai separada, por outro canal). */
export function linkDaSala(portao: PortaoConfigurado, slug: string): string {
  return `${portao.url}/t/${slug}`;
}

export function mensagemDoConvite(titulo: string, link: string, expiraEm: string | null): string {
  const prazo = expiraEm === null ? '' : `\nA sala fica aberta até ${new Date(expiraEm).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}.`;
  return `Oi! Queria que você testasse o Margem, um leitor de textos com marcas e notas na margem.\n\n`
    + `Sala: ${titulo}\nLink: ${link}\n\n`
    + `Entre com o seu nome e a senha que vou mandar em outra mensagem. Leia o texto, selecione um trecho para comentar `
    + `o que achou e, no fim, responda o formulário (leva uns 5 minutos; dá para salvar e voltar depois).${prazo}\n\nObrigado!`;
}
