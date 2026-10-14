/**
 * De onde a importação do YouTube (J109) tira os dados: o `yt-dlp` (metadados, legendas e, no máximo,
 * o áudio; nunca o vídeo) e um transcritor local opcional. As duas portas são interfaces para os testes
 * usarem falsos, sem rede.
 *
 * - `MARGEM_YT_DLP`: caminho do yt-dlp (padrão: `yt-dlp` do PATH). No app de desktop (J114) é o binário
 *   oficial dos recursos, e os desafios de JavaScript do YouTube usam o próprio Node do serviço
 *   (`--js-runtimes node:<process.execPath>`; com o Electron como Node, `ELECTRON_RUN_AS_NODE` vai junto).
 * - `MARGEM_TRANSCRITOR`: executável que recebe `<áudio> <saída.json>` e escreve
 *   `{ "motor": "...", "idioma": "pt", "palavras": [{ "texto", "inicio_s", "fim_s" }] }`
 *   (ex.: `tools/midia/transcrever_local.py`, com faster-whisper). Sem ele, vídeo sem legenda fica sem transcrição.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PalavraTranscrita } from '@margem/core';
import { urlDeAssistirNoYoutube } from '@margem/core/youtube';
import { ambienteSaneado } from '../executor/ambiente';
import { noAppDeDesktop, ytDlp } from '../plataforma/executaveis.js';
import { guardarMiniaturaDoYoutube } from './miniatura-do-video';
import { metadadosDoYtDlp, type EscolhaDaLegenda, type MetadadosDoYoutube } from './youtube';

export interface FonteDoYoutube {
  metadados(videoId: string, sinal: AbortSignal): Promise<MetadadosDoYoutube>;
  /** Guarda a miniatura do vídeo na pasta do documento (J133); opcional (os falsos dos testes não têm). */
  miniatura?(documentoId: string, videoId: string, sinal: AbortSignal): Promise<string | null>;
  /** Baixa só a legenda escolhida, em json3; devolve o conteúdo já interpretado. */
  legenda(videoId: string, escolha: EscolhaDaLegenda, pasta: string, sinal: AbortSignal): Promise<unknown>;
  /** Baixa só o áudio (nunca o vídeo); devolve o caminho do arquivo. */
  audio(videoId: string, pasta: string, sinal: AbortSignal): Promise<string>;
}

export interface TranscricaoLocal { motor: string; idioma: string; palavras: PalavraTranscrita[] }
export interface Transcritor { transcrever(audio: string, pasta: string, sinal: AbortSignal): Promise<TranscricaoLocal> }

/** Ferramenta ausente (ENOENT): a importação segue sem ela, em vez de tentar de novo. */
export class FerramentaAusente extends Error {}

const PRAZO_METADADOS_MS = 120_000;
const PRAZO_LEGENDA_MS = 120_000;
const PRAZO_AUDIO_MS = 1_800_000;
const PRAZO_TRANSCRICAO_MS = 4 * 3_600_000;

function rodar(programa: string, argumentos: string[], opcoes: { prazoMs: number; sinal: AbortSignal; ambiente?: Record<string, string> }): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    execFile(programa, argumentos, {
      timeout: opcoes.prazoMs, signal: opcoes.sinal, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true,
      env: opcoes.ambiente ?? { ...ambienteSaneado(), PYTHONIOENCODING: 'utf-8', ...electronComoNode() },
    }, (erro, stdout, stderr) => {
      if (erro) {
        if ('code' in erro && erro.code === 'ENOENT') { rejeitar(new FerramentaAusente(`${programa} não está instalado.`)); return; }
        // Só a última linha do stderr: sem despejar a saída inteira no log do job.
        const linha = String(stderr).trim().split('\n').at(-1) ?? '';
        rejeitar(new Error((linha || erro.message).slice(0, 400)));
        return;
      }
      resolver(stdout);
    });
  });
}

async function arquivoComPrefixo(pasta: string, prefixo: string, sufixo = ''): Promise<string> {
  const nome = (await readdir(pasta)).find((n) => n.startsWith(prefixo) && n.endsWith(sufixo) && !n.endsWith('.part'));
  if (nome === undefined) throw new Error(`O yt-dlp não deixou ${prefixo}*${sufixo}.`);
  return join(pasta, nome);
}

/** O Electron só se comporta como Node com `ELECTRON_RUN_AS_NODE`; repassada se o serviço roda assim. */
function electronComoNode(): Record<string, string> {
  return process.env.ELECTRON_RUN_AS_NODE === '1' ? { ELECTRON_RUN_AS_NODE: '1' } : {};
}

/** Argumentos comuns; no app de desktop, o Node do serviço resolve os desafios de JavaScript. */
export function argumentosComunsDoYtDlp(ambiente: NodeJS.ProcessEnv = process.env, node = process.execPath): string[] {
  return ['--no-playlist', '--no-warnings', '--no-progress', '--ignore-config',
    ...(noAppDeDesktop(ambiente) ? ['--js-runtimes', `node:${node}`] : [])];
}

/** O yt-dlp de verdade. Toda chamada leva `--no-playlist` e a URL canônica montada do id (nunca a do usuário). */
export function fonteYtDlp(programa = ytDlp()): FonteDoYoutube {
  const comum = argumentosComunsDoYtDlp();
  return {
    miniatura: (documentoId, videoId, sinal) => guardarMiniaturaDoYoutube(documentoId, videoId, fetch, sinal),
    async metadados(videoId, sinal) {
      const saida = await rodar(programa, [...comum, '--skip-download', '-J', urlDeAssistirNoYoutube(videoId)], { prazoMs: PRAZO_METADADOS_MS, sinal });
      return metadadosDoYtDlp(JSON.parse(saida), videoId);
    },
    async legenda(videoId, escolha, pasta, sinal) {
      await rodar(programa, [...comum, '--skip-download', escolha.automatica ? '--write-auto-subs' : '--write-subs',
        '--sub-langs', escolha.idioma, '--sub-format', 'json3', '-o', join(pasta, 'legenda.%(ext)s'), urlDeAssistirNoYoutube(videoId)], { prazoMs: PRAZO_LEGENDA_MS, sinal });
      return JSON.parse(await readFile(await arquivoComPrefixo(pasta, 'legenda.', '.json3'), 'utf8')) as unknown;
    },
    async audio(videoId, pasta, sinal) {
      // Só áudio: m4a ou webm/opus, os contêineres que o serviço sabe sondar e o navegador toca.
      await rodar(programa, [...comum, '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio[acodec!=none][vcodec=none]',
        '-o', join(pasta, 'audio.%(ext)s'), urlDeAssistirNoYoutube(videoId)], { prazoMs: PRAZO_AUDIO_MS, sinal });
      return arquivoComPrefixo(pasta, 'audio.');
    },
  };
}

function lerTranscricao(bruto: unknown): TranscricaoLocal {
  const t = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>;
  if (!Array.isArray(t.palavras)) throw new Error('O transcritor não devolveu palavras.');
  const palavras = t.palavras.flatMap((p: unknown): PalavraTranscrita[] => {
    const q = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    if (typeof q.texto !== 'string' || typeof q.inicio_s !== 'number' || typeof q.fim_s !== 'number' || !Number.isFinite(q.inicio_s) || !Number.isFinite(q.fim_s)) return [];
    // Uma "palavra" com espaço vira tokens, para o texto e as palavras andarem juntos.
    const tokens = q.texto.split(/\s+/).filter(Boolean).map((tk) => tk.slice(0, 200));
    const passo = tokens.length > 0 ? (Math.max(q.fim_s, q.inicio_s) - q.inicio_s) / tokens.length : 0;
    return tokens.map((texto, i) => ({ texto, inicio_s: Math.max(0, q.inicio_s as number) + i * passo, fim_s: Math.max(0, q.inicio_s as number) + (i + 1) * passo }));
  });
  const motor = typeof t.motor === 'string' && t.motor.trim() !== '' ? t.motor.trim().slice(0, 300) : 'transcritor local';
  const idioma = typeof t.idioma === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(t.idioma) ? t.idioma : 'und';
  return { motor, idioma, palavras };
}

/** O transcritor de `MARGEM_TRANSCRITOR`, ou `null` se não houver. */
export function transcritorDoAmbiente(ambiente: NodeJS.ProcessEnv = process.env): Transcritor | null {
  const programa = ambiente.MARGEM_TRANSCRITOR?.trim();
  if (programa === undefined || programa === '') return null;
  return {
    async transcrever(audio, pasta, sinal) {
      const saida = join(pasta, 'transcricao-local.json');
      await rodar(programa, [audio, saida], { prazoMs: PRAZO_TRANSCRICAO_MS, sinal, ambiente: {
        ...ambienteSaneado(ambiente), PYTHONIOENCODING: 'utf-8',
        // O modelo do transcritor é a única configuração repassada; nada de credencial nem do banco.
        ...(ambiente.MARGEM_WHISPER_MODELO ? { MARGEM_WHISPER_MODELO: ambiente.MARGEM_WHISPER_MODELO } : {}),
      } });
      return lerTranscricao(JSON.parse(await readFile(saida, 'utf8')));
    },
  };
}
