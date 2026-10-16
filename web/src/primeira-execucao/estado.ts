/**
 * Primeira execução de uma instalação local (J103), sem React: o que vem de
 * `GET /api/estado-instalacao` e o que a interface diz a partir disso.
 *
 * Toda frase aqui é para quem instalou o Margem no próprio computador: diz o que aconteceu e o que
 * fazer, com o comando exato quando houver um, sem jargão do serviço.
 */
import { pedir } from '../biblioteca/api';
import { jaConectou } from './ponte-do-chatgpt';

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
  /** Programas externos (mídia, YouTube, Codex), sem afetar `pronto`. Ausente se o serviço não verificou. */
  ferramentas?: Partial<Record<NomeDaFerramenta, SituacaoDaFerramenta>>;
  /** Avisos do app de computador sobre a instalação (`MARGEM_AVISOS`), um por item. */
  avisos?: string[];
  /** V-W9: a identificação deste Margem (a extensão do navegador mostra a mesma) e a porta da API. */
  instancia?: { id: string; porta: number };
  primeira_execucao: { concluida: boolean; concluida_em: string | null; exemplo_documento_id: string | null };
  pronto: boolean;
  /** `desktop`: o app de computador já escolheu a pasta e conferiu o login na janela de abertura (V-D5). */
  origem?: 'desktop';
}

export type NomeDaFerramenta = 'ffmpeg' | 'ffprobe' | 'yt_dlp' | 'codex';
export interface SituacaoDaFerramenta { ok: boolean; origem: string; mensagem?: string }

/** Os avisos do app que valem mostrar: textos não vazios, sem repetição. */
export function avisosDoApp(estado: EstadoDaInstalacao): string[] {
  return [...new Set((Array.isArray(estado.avisos) ? estado.avisos : []).filter((a) => typeof a === 'string' && a.trim() !== '').map((a) => a.trim()))];
}

/** As ferramentas de mídia que faltam, como linhas da checagem (o Codex já tem linha própria). */
export function ferramentasDaChecagem(estado: EstadoDaInstalacao): { nome: string; ok: boolean; detalhe: string }[] {
  const f = estado.ferramentas;
  if (f === undefined || typeof f !== 'object' || f === null) return [];
  const linhas: { nome: string; ok: boolean; detalhe: string }[] = [];
  const midia = [f.ffmpeg, f.ffprobe].filter((s): s is SituacaoDaFerramenta => s !== undefined);
  if (midia.length > 0) {
    const falta = midia.find((s) => !s.ok);
    linhas.push({ nome: 'Áudio e vídeo', ok: falta === undefined,
      detalhe: falta === undefined ? 'narração, vídeos e transcrições' : falta.mensagem ?? 'o ffmpeg não foi encontrado; narração e vídeos ficam indisponíveis' });
  }
  if (f.yt_dlp !== undefined) {
    linhas.push({ nome: 'Vídeos do YouTube', ok: f.yt_dlp.ok,
      detalhe: f.yt_dlp.ok ? 'importar pelo endereço do vídeo' : f.yt_dlp.mensagem ?? 'o yt-dlp não foi encontrado; importar do YouTube fica indisponível' });
  }
  return linhas;
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
  /** `app`: avisos do app de computador (ex.: o Codex roda no sandbox próprio); não impedem a leitura. */
  tipo: 'ausente' | 'deslogado' | 'incompativel' | 'cota' | 'motor' | 'banco' | 'app';
  titulo: string;
  texto: string;
  /** Comandos para copiar, na ordem: com Docker primeiro, depois sem Docker. Vazio no app de computador. */
  comandos: { rotulo: string; comando: string }[];
  /** No app de computador (U-01/W-05): o botão que resolve, no lugar dos comandos. */
  acao?: 'conectar' | 'reconectar';
}

/** No app de computador, o que falta dentro dele volta reinstalando. */
const REINSTALAR = 'Reinstale o Margem com o instalador de margem.dev; a biblioteca e as notas continuam onde estão.';

/**
 * No app de computador o Codex vem com o Margem e usa a pasta de credenciais dele: nada de npm, Docker
 * ou `codex login` no terminal (U-01/W-05). Faltando o Codex, reinstalar; deslogado, o botão.
 */
function avisoDoDesktop(estado: EstadoDaInstalacao, jaConectado: boolean): AvisoDaInstalacao | null {
  if (!estado.motor.ok) {
    return { tipo: 'motor', titulo: 'A preparação de textos não está disponível.', comandos: [],
      texto: `Textos novos não vão abrir até ela voltar. Feche e abra o Margem; se continuar, ${REINSTALAR.charAt(0).toLowerCase()}${REINSTALAR.slice(1)}` };
  }
  switch (situacaoDoCodex(estado.codex)) {
    case 'ausente':
      return { tipo: 'ausente', titulo: 'O Codex que vem com o Margem não foi encontrado.', comandos: [],
        texto: `Sem ele o Margem abre e guarda seus textos, mas não consegue marcá-los. ${REINSTALAR}` };
    case 'deslogado':
      return jaConectado
        ? { tipo: 'deslogado', titulo: 'A conexão com o ChatGPT terminou.', comandos: [], acao: 'reconectar',
          texto: 'As marcas são feitas com a sua conta do ChatGPT. Conecte de novo: o navegador abre, você entra na conta e volta para cá. Nada da biblioteca se perde.' }
        : { tipo: 'deslogado', titulo: 'O Margem não está conectado à sua conta do ChatGPT.', comandos: [], acao: 'conectar',
          texto: 'As marcas são feitas com a sua conta do ChatGPT. Conecte: o navegador abre, você entra na conta e volta para cá.' };
    case 'incompativel':
      return { tipo: 'incompativel', titulo: 'O Codex que vem com esta versão do Margem é antigo.', comandos: [],
        texto: 'Atualize o Margem em Configurações → Sobre e atualizações, ou baixe a versão nova em margem.dev.' };
    default: return null;
  }
}

/** Docker ou servidor próprio: os comandos exatos, primeiro com Docker. */
function avisoDoServidor(estado: EstadoDaInstalacao): AvisoDaInstalacao | null {
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
    default: return null;
  }
}

/**
 * O aviso que a casca do app mostra quando algo impede a leitura do Codex (ou `null`). A cota só
 * aparece quando há leitura de fato esperando por ela: o estado `adiado` dos jobs.
 */
export function avisoDaInstalacao(estado: EstadoDaInstalacao, agora: Date = new Date(), jaConectado: boolean = jaConectou()): AvisoDaInstalacao | null {
  if (!estado.banco.ok) {
    return { tipo: 'banco', titulo: 'O Margem não está falando com o banco de dados.', comandos: [],
      texto: estado.origem === 'desktop'
        ? 'Seus textos estão guardados, mas nada novo é salvo até o banco voltar. Feche e abra o Margem; se continuar, use Ajuda → Relatar um problema.'
        : 'Seus textos estão guardados, mas nada novo é salvo até o banco voltar. Reinicie o Margem; se continuar, veja os registros do serviço.' };
  }
  const doCodex = estado.origem === 'desktop' ? avisoDoDesktop(estado, jaConectado) : avisoDoServidor(estado);
  if (doCodex !== null) return doCodex;
  if (estado.cota.esgotada) {
    const volta = quandoVolta(estado.cota.volta_em, agora);
    return { tipo: 'cota', titulo: 'A cota do Codex da sua conta acabou por agora.', comandos: [],
      texto: `As leituras pedidas esperam na fila e continuam sozinhas quando ela voltar${volta ? ` (previsão: ${volta})` : ''}. Não é preciso pedir de novo.` };
  }
  const doApp = avisosDoApp(estado);
  if (doApp.length > 0) {
    return { tipo: 'app', titulo: doApp.length === 1 ? 'Um aviso sobre esta instalação.' : 'Avisos sobre esta instalação.',
      texto: doApp.join(' '), comandos: [] };
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
