/**
 * Provedor de voz falso e determinístico (J106): o que os testes e as telas de ensaio usam no lugar
 * da ElevenLabs. Gera MP3 silencioso de verdade (quadros válidos) com 50 ms por caractere e um
 * alinhamento por caractere exato, passando pelo mesmo caminho comum (pedaços, tempos, ajuste).
 */
import { MODELOS_ELEVENLABS, PEDACO_MAXIMO } from './elevenlabs';
import { duracaoDoMp3, juntarMp3, mp3Silencioso } from './mp3';
import {
  ajustarTempos, dividirEmPedacos, ErroDoProvedor, temposDasCenas, type CenaNarrada, type NarracaoGerada,
  type ProvedorDeVoz, type TipoDeErroDoProvedor, type VozDoProvedor,
} from './provedor';

export const VOZES_FALSAS: readonly VozDoProvedor[] = [
  { id: 'vozfalsa0000000000001', nome: 'Clara', categoria: 'premade', descricao: 'Voz de ensaio, sem som' },
  { id: 'vozfalsa0000000000002', nome: 'Bento', categoria: 'cloned' },
];

export interface OpcoesDoFalso {
  /** Faz toda chamada falhar com este erro (para os testes de mensagem). */
  falhar?: TipoDeErroDoProvedor;
  /** Faz só a narração falhar no pedaço `n` (1, 2, …). */
  falharNoPedaco?: { pedaco: number; tipo: TipoDeErroDoProvedor };
  /** Segundos por caractere. */
  ritmo?: number;
  /** Registro dos pedidos feitos (texto de cada pedaço), para os testes conferirem. */
  registro?: string[];
}

export function provedorFalso(opcoes: OpcoesDoFalso = {}): ProvedorDeVoz {
  const ritmo = opcoes.ritmo ?? 0.05;
  const conferir = (): void => { if (opcoes.falhar) throw new ErroDoProvedor(opcoes.falhar); };
  return {
    nome: 'elevenlabs',
    modelos: () => MODELOS_ELEVENLABS,
    async testarChave() { await Promise.resolve(); conferir(); return { creditos_restantes: 10_000 }; },
    async listarVozes() { await Promise.resolve(); conferir(); return [...VOZES_FALSAS]; },
    async narrar(pedido): Promise<NarracaoGerada> {
      conferir();
      const modelo = MODELOS_ELEVENLABS.find((m) => m.id === pedido.modelo_id);
      if (!modelo) throw new ErroDoProvedor('pedido_recusado', 'Modelo desconhecido.');
      const pedacos = dividirEmPedacos(pedido.cenas, Math.min(modelo.limite, PEDACO_MAXIMO));
      pedido.aoProgredir?.(0, pedacos.length);
      const audios: Buffer[] = [];
      for (const [indice, pedaco] of pedacos.entries()) {
        if (pedido.sinal.aborted) throw new ErroDoProvedor('cancelado');
        if (opcoes.falharNoPedaco?.pedaco === indice + 1) throw new ErroDoProvedor(opcoes.falharNoPedaco.tipo);
        opcoes.registro?.push(pedaco.texto);
        audios.push(mp3Silencioso([...pedaco.texto].length * ritmo));
        await Promise.resolve();
        pedido.aoProgredir?.(indice + 1, pedacos.length);
      }
      const junto = juntarMp3(audios);
      const cenas: CenaNarrada[] = [];
      let deslocamento = 0;
      for (const [indice, pedaco] of pedacos.entries()) {
        const caracteres = [...pedaco.texto];
        const duracao = duracaoDoMp3(audios[indice]!);
        const passo = duracao / caracteres.length;
        const alinhamento = {
          characters: caracteres,
          character_start_times_seconds: caracteres.map((_, i) => i * passo),
          character_end_times_seconds: caracteres.map((_, i) => (i + 1) * passo),
        };
        cenas.push(...temposDasCenas(pedaco, alinhamento, duracao, deslocamento).cenas);
        deslocamento += junto.duracoes[indice]!;
      }
      return { mp3: junto.bytes, total_s: deslocamento, cenas: ajustarTempos(cenas, deslocamento), avisos: [],
        caracteres: pedacos.reduce((total, p) => total + [...p.texto].length, 0) };
    },
  };
}
