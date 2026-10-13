/**
 * Primeira execução de uma instalação local (J103), sem React: o que vem de
 * `GET /api/estado-instalacao` e o que a interface diz a partir disso.
 *
 * Toda frase aqui é para quem instalou o Margem no próprio computador: diz o que aconteceu e o que
 * fazer, com o comando exato quando houver um, sem jargão do serviço.
 */
import { pedir } from '../biblioteca/api';

export interface EstadoDaInstalacao {
  versao: 1;
  banco: { ok: boolean };
  motor: { ok: boolean };
  codex: {
    encontrado: boolean;
    versao: string | null;
    compativel: boolean;
    logado: boolean | null;
    conta: 'chatgpt' | 'chave_api' | null;
    executor: 'codex' | 'falso';
  };
  cota: { esgotada: boolean; volta_em: string | null };
  primeira_execucao: { concluida: boolean; concluida_em: string | null; exemplo_documento_id: string | null };
  pronto: boolean;
}

/** Conferência mínima do que veio da rede: um serviço de outra versão não derruba a casca. */
export function pareceEstadoDaInstalacao(valor: unknown): valor is EstadoDaInstalacao {
  if (typeof valor !== 'object' || valor === null) return false;
  const v = valor as Partial<EstadoDaInstalacao>;
  return v.versao === 1 && typeof v.banco?.ok === 'boolean' && typeof v.motor?.ok === 'boolean'
    && typeof v.codex?.encontrado === 'boolean' && typeof v.cota?.esgotada === 'boolean'
    && typeof v.primeira_execucao?.concluida === 'boolean' && typeof v.pronto === 'boolean';
}

export async function obterEstadoDaInstalacao(renovar = false): Promise<EstadoDaInstalacao> {
  const corpo = await pedir<unknown>(`/api/estado-instalacao${renovar ? '?renovar=1' : ''}`);
  if (!pareceEstadoDaInstalacao(corpo)) throw new Error('Resposta fora do formato do estado da instalação.');
  return corpo;
}

export function abrirExemploDaInstalacao(): Promise<{ documento_id: string; versao_id: string; marcas: number; criado: boolean }> {
  return pedir('/api/estado-instalacao/exemplo', { method: 'POST' });
}

export function concluirPrimeiraExecucao(): Promise<{ concluida: true; concluida_em: string }> {
  return pedir('/api/estado-instalacao/concluir', { method: 'POST' });
}

/** O comando de login dentro da instalação com Docker (o serviço `worker` do compose). */
export const COMANDO_LOGIN_DOCKER = 'docker compose exec worker codex login --device-auth';
/** Sem Docker: o mesmo login, no terminal da máquina onde o Margem roda. */
export const COMANDO_LOGIN_LOCAL = 'codex login';
export const COMANDO_ATUALIZAR_DOCKER = 'docker compose pull && docker compose up -d';
export const COMANDO_INSTALAR_LOCAL = 'npm install -g @openai/codex@latest';

export type SituacaoDoCodex = 'pronto' | 'falso' | 'ausente' | 'incompativel' | 'deslogado' | 'chave_api' | 'desconhecido';

/** Uma palavra para o estado do Codex; a ordem decide o que é dito primeiro. */
export function situacaoDoCodex(codex: EstadoDaInstalacao['codex']): SituacaoDoCodex {
  if (codex.executor === 'falso') return 'falso';
  if (!codex.encontrado) return 'ausente';
  if (codex.logado === false) return 'deslogado';
  if (!codex.compativel) return 'incompativel';
  if (codex.logado === null) return 'desconhecido';
  if (codex.conta === 'chave_api') return 'chave_api';
  return 'pronto';
}

/** "às 14:30" hoje, "amanhã às 08:00" ou "em 12/10 às 09:15", no fuso do navegador. */
export function quandoVolta(iso: string | null, agora: Date = new Date()): string | null {
  if (iso === null) return null;
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;
  const hora = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = (d: Date) => `${String(d.getFullYear())}-${String(d.getMonth())}-${String(d.getDate())}`;
  const amanha = new Date(agora); amanha.setDate(agora.getDate() + 1);
  if (dia(quando) === dia(agora)) return `às ${hora}`;
  if (dia(quando) === dia(amanha)) return `amanhã às ${hora}`;
  return `em ${quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
}

export interface AvisoDaInstalacao {
  tipo: 'ausente' | 'deslogado' | 'incompativel' | 'cota' | 'motor' | 'banco';
  titulo: string;
  texto: string;
  /** Comandos para copiar, na ordem: com Docker primeiro, depois sem Docker. */
  comandos: { rotulo: string; comando: string }[];
}

/**
 * O aviso que a casca do app mostra quando algo impede a leitura do Codex (ou `null`). A cota só
 * aparece quando há leitura de fato esperando por ela: o estado `adiado` dos jobs.
 */
export function avisoDaInstalacao(estado: EstadoDaInstalacao, agora: Date = new Date()): AvisoDaInstalacao | null {
  if (!estado.banco.ok) {
    return { tipo: 'banco', titulo: 'O Margem não está falando com o banco de dados.', comandos: [],
      texto: 'Seus textos estão guardados, mas nada novo é salvo até o banco voltar. Reinicie o Margem; se continuar, veja os registros do serviço.' };
  }
  if (!estado.motor.ok) {
    return { tipo: 'motor', titulo: 'A preparação de textos não está disponível.', comandos: [{ rotulo: 'Com Docker', comando: COMANDO_ATUALIZAR_DOCKER }],
      texto: 'Textos novos não vão abrir até ela voltar. Atualize e reinicie o Margem.' };
  }
  switch (situacaoDoCodex(estado.codex)) {
    case 'ausente':
      return { tipo: 'ausente', titulo: 'O Codex não está instalado aqui.',
        texto: 'Sem ele o Margem abre e guarda seus textos, mas não consegue marcá-los. Com Docker, ele já vem na imagem: atualize. Sem Docker, instale o Codex e reinicie o Margem.',
        comandos: [{ rotulo: 'Com Docker', comando: COMANDO_ATUALIZAR_DOCKER }, { rotulo: 'Sem Docker', comando: COMANDO_INSTALAR_LOCAL }] };
    case 'deslogado':
      return { tipo: 'deslogado', titulo: 'O Codex não está conectado à sua conta do ChatGPT.',
        texto: 'As marcas são feitas pelo Codex com a sua conta. Rode o comando no terminal, abra o endereço que ele mostrar, entre na sua conta e digite o código.',
        comandos: [{ rotulo: 'Com Docker', comando: COMANDO_LOGIN_DOCKER }, { rotulo: 'Sem Docker', comando: COMANDO_LOGIN_LOCAL }] };
    case 'incompativel':
      return { tipo: 'incompativel', titulo: 'A versão instalada do Codex é antiga para o Margem.',
        texto: `${estado.codex.versao ? `Encontramos ${estado.codex.versao}. ` : ''}Atualize o Codex e reinicie o Margem.`,
        comandos: [{ rotulo: 'Com Docker', comando: COMANDO_ATUALIZAR_DOCKER }, { rotulo: 'Sem Docker', comando: COMANDO_INSTALAR_LOCAL }] };
    default: break;
  }
  if (estado.cota.esgotada) {
    const volta = quandoVolta(estado.cota.volta_em, agora);
    return { tipo: 'cota', titulo: 'A cota do Codex da sua conta acabou por agora.', comandos: [],
      texto: `As leituras pedidas esperam na fila e continuam sozinhas quando ela voltar${volta ? ` (previsão: ${volta})` : ''}. Não é preciso pedir de novo.` };
  }
  return null;
}

/**
 * O diálogo da primeira execução aparece enquanto ela não foi concluída, fora do leitor e se a
 * pessoa não pediu "Depois" nesta aba. Sem resposta do serviço (versão anterior ao J103), nunca.
 */
export function mostrarPrimeiraExecucao(estado: EstadoDaInstalacao | null, adiada: boolean, lendo: boolean): boolean {
  return estado !== null && !estado.primeira_execucao.concluida && !adiada && !lendo;
}
