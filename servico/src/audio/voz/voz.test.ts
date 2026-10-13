/**
 * Provedor de voz (J106) sem rede: MP3, divisão em pedidos, alinhamento por caractere e o cliente da
 * ElevenLabs contra um `fetch` falso que imita as respostas documentadas (200, 401, 402, 403, 429, 5xx).
 */
import { describe, expect, test } from 'vitest';
import { provedorElevenLabs, classificarErro, MODELOS_ELEVENLABS, type Buscar } from './elevenlabs';
import { provedorFalso } from './falso';
import { duracaoDoMp3, juntarMp3, mp3Silencioso, quadrosDoMp3 } from './mp3';
import {
  ajustarTempos, dividirEmPedacos, ErroDoProvedor, estimar, redigir, temposDasCenas, type CenaParaNarrar,
} from './provedor';

const CHAVE = 'sk_teste_0123456789abcdefWXYZ';
const cenas = (textos: string[], blocos: number[] = []): CenaParaNarrar[] =>
  textos.map((texto, i) => ({ cena: `c${String(i + 1).padStart(3, '0')}`, texto, novoBloco: blocos.includes(i) }));

describe('mp3', () => {
  test('conta quadros, ignora ID3 e junta pedaços com a duração de cada um', () => {
    const um = mp3Silencioso(1);
    expect(duracaoDoMp3(um)).toBeCloseTo(1, 1);
    const id3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 5]), Buffer.alloc(5), mp3Silencioso(0.5)]);
    expect(quadrosDoMp3(id3)[0]!.inicio).toBe(15);
    const junto = juntarMp3([um, id3]);
    expect(junto.duracoes[0]).toBeCloseTo(1, 1);
    expect(junto.duracoes[1]).toBeCloseTo(0.5, 1);
    expect(duracaoDoMp3(junto.bytes)).toBeCloseTo(junto.duracoes[0]! + junto.duracoes[1]!, 6);
    expect(junto.bytes.subarray(0, 3).toString('latin1')).not.toBe('ID3');
    expect(() => quadrosDoMp3(Buffer.from('não é áudio'))).toThrow('não é MP3');
  });
});

describe('roteiro em pedidos', () => {
  test('agrupa cenas até o limite, separa blocos com parágrafo e marca onde cada cena está', () => {
    const pedacos = dividirEmPedacos(cenas(['Primeira frase.', 'Segunda 🧭 frase.', 'Outro bloco.'], [2]), 40);
    expect(pedacos).toHaveLength(2);
    expect(pedacos[0]!.texto).toBe('Primeira frase. Segunda 🧭 frase.');
    expect(pedacos[0]!.cenas[1]).toMatchObject({ cena: 'c002', inicio: 16, fim: 32 });
    expect(pedacos[1]!.texto).toBe('Outro bloco.');
    const juntos = dividirEmPedacos(cenas(['Um.', 'Dois.'], [1]), 100);
    expect(juntos[0]!.texto).toBe('Um.\n\nDois.');
    expect(() => dividirEmPedacos(cenas(['x'.repeat(50)]), 40)).toThrow('limite');
  });

  test('estimativa: caracteres enviados, créditos e referência em dólares por modelo', () => {
    const multi = MODELOS_ELEVENLABS.find((m) => m.id === 'eleven_multilingual_v2')!;
    const flash = MODELOS_ELEVENLABS.find((m) => m.id === 'eleven_flash_v2_5')!;
    const roteiro = cenas(['a'.repeat(999), 'b'.repeat(1000)]);
    expect(estimar(roteiro, multi)).toEqual({ caracteres: 2000, pedidos: 1, creditos: 2000, custo_usd: 0.16 });
    expect(estimar(roteiro, flash)).toMatchObject({ creditos: 1000, custo_usd: 0.08 });
  });

  test('tempos por cena saem do alinhamento por caractere; sem ele, repartidos e marcados como aproximados', () => {
    const [pedaco] = dividirEmPedacos(cenas(['Olá 🧭.', 'Fim.']), 100);
    const caracteres = [...pedaco!.texto];
    const alinhamento = { characters: caracteres, character_start_times_seconds: caracteres.map((_, i) => i * 0.1), character_end_times_seconds: caracteres.map((_, i) => i * 0.1 + 0.1) };
    const exato = temposDasCenas(pedaco!, alinhamento, 2, 10);
    expect(exato.aproximado).toBe(false);
    expect(exato.cenas[0]).toMatchObject({ inicio_s: 10, fim_s: 10.6 });
    expect(exato.cenas[1]!.inicio_s).toBeCloseTo(10.7);
    const aproximado = temposDasCenas(pedaco!, { ...alinhamento, characters: caracteres.slice(1) }, 2, 0);
    expect(aproximado.aproximado).toBe(true);
    expect(aproximado.cenas[1]!.fim_s).toBeCloseTo(2);
    expect(ajustarTempos([{ cena: 'a', narracao: '', inicio_s: 0, fim_s: 1 }, { cena: 'b', narracao: '', inicio_s: 0.5, fim_s: 3 }], 2))
      .toEqual([{ cena: 'a', narracao: '', inicio_s: 0, fim_s: 1 }, { cena: 'b', narracao: '', inicio_s: 1, fim_s: 2 }]);
  });

  test('redigir tira a chave de qualquer texto', () => {
    expect(redigir(`erro com ${CHAVE} no meio`, CHAVE)).toBe('erro com [chave omitida] no meio');
    expect(redigir('nada', null)).toBe('nada');
  });
});

interface Chamada { url: string; metodo: string; cabecalhos: Record<string, string>; corpo: Record<string, unknown> | null }

/** `fetch` falso: cada resposta da fila é usada uma vez, na ordem. */
function servidorFalso(respostas: (Response | Error | ((c: Chamada) => Response))[]): { buscar: Buscar; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const buscar: Buscar = (url, inicio) => {
    const chamada: Chamada = { url, metodo: inicio.method ?? 'GET', cabecalhos: inicio.headers as Record<string, string>,
      corpo: typeof inicio.body === 'string' ? JSON.parse(inicio.body) as Record<string, unknown> : null };
    chamadas.push(chamada);
    const proxima = respostas.shift();
    if (!proxima) throw new Error('chamada a mais');
    if (proxima instanceof Error) return Promise.reject(proxima);
    return Promise.resolve(typeof proxima === 'function' ? proxima(chamada) : proxima);
  };
  return { buscar, chamadas };
}
const json = (corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cabecalhos } });
const tts = (c: Chamada): Response => {
  const texto = String(c.corpo?.text);
  const caracteres = [...texto];
  return json({ audio_base64: mp3Silencioso(caracteres.length * 0.05).toString('base64'),
    alignment: { characters: caracteres, character_start_times_seconds: caracteres.map((_, i) => i * 0.05), character_end_times_seconds: caracteres.map((_, i) => (i + 1) * 0.05) } });
};
const semEspera = (): Promise<void> => Promise.resolve();
const sinal = new AbortController().signal;

describe('ElevenLabs com fetch falso', () => {
  test('narra em pedidos com a chave no cabeçalho, contexto entre pedaços e tempos por cena', async () => {
    const { buscar, chamadas } = servidorFalso([tts, tts]);
    const progresso: string[] = [];
    const roteiro = cenas(['a'.repeat(1500) + '.', 'b'.repeat(1500) + '.']);
    const narracao = await provedorElevenLabs({ chave: CHAVE, buscar, esperar: semEspera }).narrar({
      cenas: roteiro, voz_id: 'JBFqnCBsd6RMkjVDRZzb', modelo_id: 'eleven_multilingual_v2', sinal,
      aoProgredir: (feitos, total) => progresso.push(`${String(feitos)}/${String(total)}`),
    });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/with-timestamps?output_format=mp3_44100_128');
    expect(chamadas[0]!.metodo).toBe('POST');
    expect(chamadas[0]!.cabecalhos['xi-api-key']).toBe(CHAVE);
    expect(chamadas[0]!.corpo).toMatchObject({ model_id: 'eleven_multilingual_v2', text: 'a'.repeat(1500) + '.' });
    expect(chamadas[0]!.corpo?.next_text).toBe('b'.repeat(500));
    expect(chamadas[1]!.corpo?.previous_text).toBe('a'.repeat(499) + '.');
    expect(progresso).toEqual(['0/2', '1/2', '2/2']);
    expect(narracao.caracteres).toBe(3002);
    expect(narracao.avisos).toEqual([]);
    expect(narracao.cenas).toHaveLength(2);
    expect(narracao.cenas[1]!.inicio_s).toBeGreaterThanOrEqual(narracao.cenas[0]!.fim_s);
    expect(narracao.cenas[1]!.fim_s).toBeLessThanOrEqual(narracao.total_s);
    expect(narracao.total_s).toBeCloseTo(duracaoDoMp3(narracao.mp3), 6);
  });

  test.each([
    [401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }, 'chave_invalida', 'Chave inválida'],
    [401, { detail: { status: 'quota_exceeded', message: 'quota' } }, 'sem_creditos', 'Sem créditos'],
    [402, { detail: { type: 'payment_required', code: 'insufficient_credits' } }, 'sem_creditos', 'Sem créditos'],
    [401, { detail: { status: 'missing_permissions', message: 'needs text_to_speech' } }, 'permissao', 'permissão'],
    [403, { detail: { code: 'voice_access_denied' } }, 'permissao', 'permissão'],
    [404, { detail: { code: 'voice_not_found' } }, 'voz_inexistente', 'voz escolhida'],
  ])('HTTP %i vira mensagem clara e não tenta de novo', async (status, corpo, tipo, trecho) => {
    const { buscar, chamadas } = servidorFalso([json(corpo, status)]);
    const erro = await provedorElevenLabs({ chave: CHAVE, buscar, esperar: semEspera })
      .narrar({ cenas: cenas(['Oi.']), voz_id: 'v1', modelo_id: 'eleven_flash_v2_5', sinal }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDoProvedor);
    expect((erro as ErroDoProvedor).tipo).toBe(tipo);
    expect((erro as ErroDoProvedor).message).toContain(trecho);
    expect(chamadas).toHaveLength(1);
  });

  test('429 e 5xx tentam de novo (respeitando Retry-After); esgotado, "limite" ou "indisponível"', async () => {
    const esperas: number[] = [];
    const esperar = (ms: number): Promise<void> => { esperas.push(ms); return Promise.resolve(); };
    const recupera = servidorFalso([json({ detail: { code: 'concurrent_limit_exceeded' } }, 429, { 'retry-after': '3' }), new Error('rede caiu'), json({}, 503), tts]);
    const ok = await provedorElevenLabs({ chave: CHAVE, buscar: recupera.buscar, esperar }).narrar({ cenas: cenas(['Oi.']), voz_id: 'v1', modelo_id: 'eleven_v3', sinal });
    expect(ok.cenas).toHaveLength(1);
    expect(esperas).toEqual([3000, 2000, 4000]);
    const sempreLimite = servidorFalso(Array.from({ length: 4 }, () => json({ detail: { code: 'rate_limit_exceeded' } }, 429)));
    await expect(provedorElevenLabs({ chave: CHAVE, buscar: sempreLimite.buscar, esperar: semEspera })
      .narrar({ cenas: cenas(['Oi.']), voz_id: 'v1', modelo_id: 'eleven_v3', sinal })).rejects.toMatchObject({ tipo: 'limite' });
    const fora = servidorFalso(Array.from({ length: 4 }, () => json({}, 500)));
    await expect(provedorElevenLabs({ chave: CHAVE, buscar: fora.buscar, esperar: semEspera })
      .narrar({ cenas: cenas(['Oi.']), voz_id: 'v1', modelo_id: 'eleven_v3', sinal })).rejects.toMatchObject({ tipo: 'indisponivel' });
  });

  test('mensagem da API que ecoa a chave é redigida', () => {
    const erro = classificarErro(400, { code: 'invalid_parameters', message: `key ${CHAVE} not allowed here` }, CHAVE);
    expect(erro?.tipo).toBe('pedido_recusado');
    expect(erro?.message).not.toContain(CHAVE);
    expect(erro?.message).toContain('[chave omitida]');
  });

  test('alinhamento ausente: publica com tempos repartidos e avisa', async () => {
    const { buscar } = servidorFalso([json({ audio_base64: mp3Silencioso(1).toString('base64') })]);
    const narracao = await provedorElevenLabs({ chave: CHAVE, buscar, esperar: semEspera }).narrar({ cenas: cenas(['Um.', 'Dois.']), voz_id: 'v1', modelo_id: 'eleven_v3', sinal });
    expect(narracao.avisos[0]).toContain('sem alinhamento');
    expect(narracao.cenas.map((c) => c.cena)).toEqual(['c001', 'c002']);
  });

  test('áudio que não é MP3 vira "resposta inválida"', async () => {
    const { buscar } = servidorFalso([json({ audio_base64: Buffer.from('xx').toString('base64'), alignment: null })]);
    await expect(provedorElevenLabs({ chave: CHAVE, buscar, esperar: semEspera }).narrar({ cenas: cenas(['Oi.']), voz_id: 'v1', modelo_id: 'eleven_v3', sinal }))
      .rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });

  test('vozes paginadas e teste da chave com saldo; chave restrita sem leitura do usuário ainda passa', async () => {
    const vozes = servidorFalso([
      json({ voices: [{ voice_id: 'a1', name: 'Ana', category: 'premade' }, { voice_id: '../x', name: 'Ruim' }], has_more: true, next_page_token: 'p2' }),
      json({ voices: [{ voice_id: 'b2', name: 'Bia', description: 'Calma' }], has_more: false, next_page_token: null }),
    ]);
    expect(await provedorElevenLabs({ chave: CHAVE, buscar: vozes.buscar }).listarVozes())
      .toEqual([{ id: 'a1', nome: 'Ana', categoria: 'premade' }, { id: 'b2', nome: 'Bia', descricao: 'Calma' }]);
    expect(vozes.chamadas[1]!.url).toContain('next_page_token=p2');
    const comSaldo = servidorFalso([json({ voices: [] }), json({ character_count: 300, character_limit: 1000 })]);
    expect(await provedorElevenLabs({ chave: CHAVE, buscar: comSaldo.buscar }).testarChave()).toEqual({ creditos_restantes: 700 });
    const restrita = servidorFalso([json({ voices: [] }), json({ detail: { status: 'missing_permissions' } }, 401)]);
    expect(await provedorElevenLabs({ chave: CHAVE, buscar: restrita.buscar }).testarChave()).toEqual({});
    const invalida = servidorFalso([json({ detail: { status: 'invalid_api_key' } }, 401)]);
    await expect(provedorElevenLabs({ chave: CHAVE, buscar: invalida.buscar }).testarChave()).rejects.toMatchObject({ tipo: 'chave_invalida' });
  });

  test('o provedor falso segue o mesmo contrato', async () => {
    const registro: string[] = [];
    const narracao = await provedorFalso({ registro }).narrar({ cenas: cenas(['Um.', 'Dois.'], [1]), voz_id: 'v', modelo_id: 'eleven_multilingual_v2', sinal });
    expect(registro).toEqual(['Um.\n\nDois.']);
    expect(narracao.cenas[1]!.fim_s).toBeLessThanOrEqual(narracao.total_s);
    await expect(provedorFalso({ falhar: 'sem_creditos' }).testarChave()).rejects.toMatchObject({ tipo: 'sem_creditos' });
  });
});
