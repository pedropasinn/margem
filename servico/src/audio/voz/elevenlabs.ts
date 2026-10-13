/**
 * Provedor ElevenLabs (J106), com a chave da própria pessoa.
 *
 * Documentação oficial consultada em 12/10/2026:
 * - `POST /v1/text-to-speech/{voice_id}/with-timestamps` — corpo `{text, model_id, previous_text,
 *   next_text}`, consulta `output_format`; resposta `{audio_base64, alignment: {characters,
 *   character_start_times_seconds, character_end_times_seconds}, normalized_alignment}`.
 * - `GET /v2/voices?page_size=100&next_page_token=…` — `{voices: [{voice_id, name, category,
 *   description}], has_more, next_page_token}`.
 * - `GET /v1/user/subscription` — `{character_count, character_limit}` (exige permissão de leitura do usuário).
 * - Autenticação pelo cabeçalho `xi-api-key`. Erros em `{detail: {type, code, status, message}}`:
 *   401 chave inválida (ou, em contas antigas, `quota_exceeded`), 402 sem créditos, 403 sem permissão,
 *   404 voz inexistente, 429 limite de taxa ou de concorrência, 5xx indisponível.
 * - Limite por pedido: 10.000 caracteres no Multilingual v2, 5.000 no v3, 40.000 no Flash v2.5.
 * - Créditos: 1 por caractere nos modelos multilíngues, 0,5 nos Flash/Turbo; preço pago por uso da API
 *   US$ 0,08 (multilíngues) e US$ 0,04 (Flash/Turbo) por 1.000 caracteres.
 *
 * Nada aqui escreve a chave em log, erro ou artefato: as mensagens são as de `MENSAGENS_DO_PROVEDOR`,
 * e qualquer texto vindo da API passa por `redigir`.
 */
import { juntarMp3 } from './mp3';
import {
  ajustarTempos, dividirEmPedacos, ErroDoProvedor, redigir, temposDasCenas,
  type AlinhamentoPorCaractere, type CenaNarrada, type ModeloDeVoz, type NarracaoGerada, type PedidoDeNarracao,
  type ProvedorDeVoz, type VozDoProvedor,
} from './provedor';

export const ENDERECO_ELEVENLABS = 'https://api.elevenlabs.io';
export const FORMATO_DE_SAIDA = 'mp3_44100_128';
/** Pedaços menores que o limite do modelo: uma falha custa pouco e a voz não se arrasta. */
export const PEDACO_MAXIMO = 2500;
export const MODELO_PADRAO = 'eleven_multilingual_v2';

export const MODELOS_ELEVENLABS: readonly ModeloDeVoz[] = [
  { id: 'eleven_multilingual_v2', nome: 'Multilingual v2 (mais natural)', limite: 10_000, creditosPorCaractere: 1, usdPorMil: 0.08 },
  { id: 'eleven_v3', nome: 'Eleven v3 (mais expressivo)', limite: 5_000, creditosPorCaractere: 1, usdPorMil: 0.08 },
  { id: 'eleven_flash_v2_5', nome: 'Flash v2.5 (mais barato e rápido)', limite: 40_000, creditosPorCaractere: 0.5, usdPorMil: 0.04 },
  { id: 'eleven_turbo_v2_5', nome: 'Turbo v2.5', limite: 40_000, creditosPorCaractere: 0.5, usdPorMil: 0.04 },
];

export type Buscar = (url: string, inicio: RequestInit) => Promise<Response>;

export interface OpcoesElevenLabs {
  chave: string;
  buscar?: Buscar;
  endereco?: string;
  /** Pausa entre tentativas; os testes passam uma que não espera. */
  esperar?: (ms: number, sinal?: AbortSignal) => Promise<void>;
  tentativas?: number;
  prazoMs?: number;
}

function esperarDeVerdade(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    if (sinal?.aborted) { resolver(); return; }
    const relogio = setTimeout(() => { sinal?.removeEventListener('abort', parar); resolver(); }, ms);
    function parar(): void { clearTimeout(relogio); resolver(); }
    sinal?.addEventListener('abort', parar, { once: true });
  });
}

interface DetalheDoErro { status?: string; code?: string; message?: string }
async function detalheDoErro(resposta: Response): Promise<DetalheDoErro> {
  try {
    const corpo = await resposta.json() as { detail?: unknown };
    const detalhe = corpo.detail;
    if (typeof detalhe === 'string') return { message: detalhe };
    if (detalhe && typeof detalhe === 'object') {
      const d = detalhe as Record<string, unknown>;
      return {
        ...(typeof d.status === 'string' ? { status: d.status } : {}),
        ...(typeof d.code === 'string' ? { code: d.code } : {}),
        ...(typeof d.message === 'string' ? { message: d.message } : {}),
      };
    }
  } catch { /* corpo não é JSON */ }
  return {};
}

/** Status HTTP + detalhe → erro com mensagem clara. `null` quando vale tentar de novo. */
export function classificarErro(status: number, detalhe: DetalheDoErro, chave: string): ErroDoProvedor | null {
  const codigos = [detalhe.status, detalhe.code].filter((c): c is string => typeof c === 'string');
  const tem = (...nomes: string[]): boolean => codigos.some((c) => nomes.includes(c));
  if (tem('quota_exceeded', 'insufficient_credits', 'payment_required') || status === 402) return new ErroDoProvedor('sem_creditos');
  if (tem('missing_permissions', 'insufficient_permissions', 'voice_access_denied', 'model_access_denied', 'feature_not_available', 'subscription_required')
    || status === 403) return new ErroDoProvedor('permissao');
  if (status === 401) return new ErroDoProvedor('chave_invalida');
  if (status === 404 || tem('voice_not_found')) return new ErroDoProvedor('voz_inexistente');
  if (status === 429 || status >= 500) return null;
  const mensagem = detalhe.message ? redigir(detalhe.message, chave).replace(/\s+/gu, ' ').slice(0, 200) : `HTTP ${String(status)}.`;
  return new ErroDoProvedor('pedido_recusado', mensagem);
}

function ehAlinhamento(valor: unknown): valor is AlinhamentoPorCaractere {
  const a = valor as Partial<AlinhamentoPorCaractere> | null;
  return a !== null && typeof a === 'object' && Array.isArray(a.characters) && Array.isArray(a.character_start_times_seconds)
    && Array.isArray(a.character_end_times_seconds) && a.characters.every((c) => typeof c === 'string')
    && a.character_start_times_seconds.every((n) => typeof n === 'number') && a.character_end_times_seconds.every((n) => typeof n === 'number');
}

export function provedorElevenLabs(opcoes: OpcoesElevenLabs): ProvedorDeVoz {
  const buscar: Buscar = opcoes.buscar ?? ((url, inicio) => fetch(url, inicio));
  const endereco = opcoes.endereco ?? ENDERECO_ELEVENLABS;
  const esperar = opcoes.esperar ?? esperarDeVerdade;
  const tentativas = opcoes.tentativas ?? 4;
  const prazoMs = opcoes.prazoMs ?? 120_000;
  const { chave } = opcoes;

  /** Uma chamada com retentativa para 429, 5xx e falha de rede (espera crescente, respeita Retry-After). */
  async function chamar(caminho: string, inicio: RequestInit, sinal?: AbortSignal): Promise<Response> {
    let ultimo: 'limite' | 'indisponivel' = 'indisponivel';
    for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
      if (sinal?.aborted) throw new ErroDoProvedor('cancelado');
      const prazo = AbortSignal.timeout(prazoMs);
      let resposta: Response;
      try {
        resposta = await buscar(`${endereco}${caminho}`, {
          ...inicio,
          headers: { ...(inicio.headers as Record<string, string> | undefined), 'xi-api-key': chave, accept: 'application/json' },
          signal: sinal ? AbortSignal.any([sinal, prazo]) : prazo,
        });
      } catch {
        if (sinal?.aborted) throw new ErroDoProvedor('cancelado');
        ultimo = 'indisponivel';
        await esperar(1000 * 2 ** tentativa, sinal);
        continue;
      }
      if (resposta.ok) return resposta;
      const erro = classificarErro(resposta.status, await detalheDoErro(resposta), chave);
      if (erro) throw erro;
      ultimo = resposta.status === 429 ? 'limite' : 'indisponivel';
      const depois = Number(resposta.headers.get('retry-after'));
      await esperar(Number.isFinite(depois) && depois > 0 ? Math.min(depois, 60) * 1000 : 1000 * 2 ** tentativa, sinal);
    }
    throw new ErroDoProvedor(ultimo);
  }

  async function json(resposta: Response): Promise<unknown> {
    try { return await resposta.json(); } catch { throw new ErroDoProvedor('resposta_invalida'); }
  }

  return {
    nome: 'elevenlabs',
    modelos: () => MODELOS_ELEVENLABS,

    async testarChave(sinal) {
      // A listagem de vozes é o que o app usa; se ela passa, a chave serve.
      await chamar('/v2/voices?page_size=1', { method: 'GET' }, sinal);
      try {
        const assinatura = await json(await chamar('/v1/user/subscription', { method: 'GET' }, sinal)) as Record<string, unknown>;
        const usados = assinatura.character_count, limite = assinatura.character_limit;
        return typeof usados === 'number' && typeof limite === 'number' ? { creditos_restantes: Math.max(0, limite - usados) } : {};
      } catch (erro) {
        // Chave restrita sem leitura do usuário ainda serve para narrar: só não sabemos o saldo.
        if (erro instanceof ErroDoProvedor && erro.tipo === 'permissao') return {};
        throw erro;
      }
    },

    async listarVozes(sinal) {
      const vozes: VozDoProvedor[] = [];
      let token: string | null = null;
      for (let pagina = 0; pagina < 10; pagina += 1) {
        const consulta = new URLSearchParams({ page_size: '100' });
        if (token) consulta.set('next_page_token', token);
        const corpo = await json(await chamar(`/v2/voices?${consulta.toString()}`, { method: 'GET' }, sinal)) as Record<string, unknown>;
        if (!Array.isArray(corpo.voices)) throw new ErroDoProvedor('resposta_invalida');
        for (const bruta of corpo.voices as unknown[]) {
          const v = bruta as Record<string, unknown>;
          if (typeof v.voice_id !== 'string' || typeof v.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(v.voice_id)) continue;
          vozes.push({ id: v.voice_id, nome: v.name.slice(0, 200),
            ...(typeof v.category === 'string' ? { categoria: v.category } : {}),
            ...(typeof v.description === 'string' && v.description.trim() !== '' ? { descricao: v.description.slice(0, 300) } : {}) });
        }
        token = corpo.has_more === true && typeof corpo.next_page_token === 'string' ? corpo.next_page_token : null;
        if (!token) break;
      }
      return vozes;
    },

    async narrar(pedido: PedidoDeNarracao): Promise<NarracaoGerada> {
      const modelo = MODELOS_ELEVENLABS.find((m) => m.id === pedido.modelo_id);
      if (!modelo) throw new ErroDoProvedor('pedido_recusado', 'Modelo desconhecido.');
      if (!/^[A-Za-z0-9_-]{1,64}$/u.test(pedido.voz_id)) throw new ErroDoProvedor('voz_inexistente');
      const pedacos = dividirEmPedacos(pedido.cenas, Math.min(modelo.limite, PEDACO_MAXIMO));
      if (pedacos.length === 0) throw new ErroDoProvedor('pedido_recusado', 'Não há texto para narrar.');
      const audios: Buffer[] = [];
      const alinhamentos: (AlinhamentoPorCaractere | null)[] = [];
      pedido.aoProgredir?.(0, pedacos.length);
      for (const [indice, pedaco] of pedacos.entries()) {
        const anterior = pedacos[indice - 1]?.texto.slice(-500);
        const seguinte = pedacos[indice + 1]?.texto.slice(0, 500);
        const resposta = await chamar(
          `/v1/text-to-speech/${encodeURIComponent(pedido.voz_id)}/with-timestamps?output_format=${FORMATO_DE_SAIDA}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
            text: pedaco.texto, model_id: modelo.id,
            ...(anterior ? { previous_text: anterior } : {}), ...(seguinte ? { next_text: seguinte } : {}),
          }) },
          pedido.sinal,
        );
        const corpo = await json(resposta) as Record<string, unknown>;
        if (typeof corpo.audio_base64 !== 'string' || corpo.audio_base64 === '') throw new ErroDoProvedor('resposta_invalida');
        audios.push(Buffer.from(corpo.audio_base64, 'base64'));
        alinhamentos.push(ehAlinhamento(corpo.alignment) ? corpo.alignment : null);
        pedido.aoProgredir?.(indice + 1, pedacos.length);
      }
      let junto: ReturnType<typeof juntarMp3>;
      try { junto = juntarMp3(audios); } catch { throw new ErroDoProvedor('resposta_invalida'); }
      const avisos: string[] = [];
      const cenas: CenaNarrada[] = [];
      let deslocamento = 0;
      for (const [indice, pedaco] of pedacos.entries()) {
        const duracao = junto.duracoes[indice]!;
        const tempos = temposDasCenas(pedaco, alinhamentos[indice] ?? null, duracao, deslocamento);
        if (tempos.aproximado) avisos.push(`Pedaço ${String(indice + 1)}: sem alinhamento por caractere; tempos repartidos pelo tamanho das frases.`);
        cenas.push(...tempos.cenas);
        deslocamento += duracao;
      }
      return {
        mp3: junto.bytes, total_s: deslocamento, cenas: ajustarTempos(cenas, deslocamento), avisos,
        caracteres: pedacos.reduce((total, p) => total + [...p.texto].length, 0),
      };
    },
  };
}
