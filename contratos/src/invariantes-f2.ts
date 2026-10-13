import type {
  Bloco, ConexaoV1, ConexaoV2, ExecucaoLeituraV2, Funcao, Id, MarcaGeradaV2, MarcaV1, MarcaV2, ModoDeLeituraV1, RespostaGeradaV1,
} from './tipos';
import { MODO_F1, mesmoModo } from './modos';
import { validarConexao, validarConexaoV2, validarExecucaoLeituraV2, validarMarca, validarMarcaGeradaV2, validarMarcaV2, validarModoDeLeitura } from './validadores';

export type Localizacao =
  | { tipo: 'unica'; inicio_utf16: number; fim_utf16: number }
  | { tipo: 'ambigua'; ocorrencias: number }
  | { tipo: 'ausente' };
/**
 * Procura a citação literal no bloco, com prefixo/sufixo imediatamente adjacentes quando informados.
 * Nunca escolhe a primeira de várias ocorrências: devolve `ambigua` com a contagem.
 */
export function localizarCitacao(bloco: Pick<Bloco, 'texto'>, citacao: string, prefixo = '', sufixo = ''): Localizacao {
  if (!citacao) return { tipo: 'ausente' };
  const achadas: number[] = [];
  for (let inicio = bloco.texto.indexOf(citacao); inicio !== -1; inicio = bloco.texto.indexOf(citacao, inicio + 1)) {
    if (bloco.texto.slice(0, inicio).endsWith(prefixo) && bloco.texto.slice(inicio + citacao.length).startsWith(sufixo)) achadas.push(inicio);
  }
  const [inicio] = achadas;
  if (inicio === undefined) return { tipo: 'ausente' };
  if (achadas.length > 1) return { tipo: 'ambigua', ocorrencias: achadas.length };
  return { tipo: 'unica', inicio_utf16: inicio, fim_utf16: inicio + citacao.length };
}

/** A função e o tipo de comentário pertencem ao modo; para `MarcaV2`, a referência de modo também confere. */
export function conferirMarcaNoModo(marca: MarcaGeradaV2 | MarcaV2, modo: ModoDeLeituraV1): boolean {
  if (!validarModoDeLeitura(modo)) return false;
  if ('modo' in marca && !mesmoModo(marca.modo, modo)) return false;
  return (marca.funcao === 'nenhuma' || modo.funcoes.some((funcao) => funcao.chave === marca.funcao)) &&
    (marca.comentario === null || modo.comentarios.includes(marca.comentario.tipo));
}
/** Como `conferirMarcaGerada` da V1: exatamente uma ocorrência compatível no bloco. */
export function conferirMarcaGeradaV2(bloco: Pick<Bloco, 'id' | 'texto'>, marca: MarcaGeradaV2): boolean {
  return validarMarcaGeradaV2(marca) && bloco.id === marca.bloco_id &&
    localizarCitacao(bloco, marca.citacao, marca.prefixo, marca.sufixo).tipo === 'unica';
}
/** Marca gerada numa execução: modo da execução, função e comentário do modo, saliência ≤ nível de atenção alvo. */
export function conferirMarcaGeradaNaExecucao(marca: MarcaGeradaV2, execucao: ExecucaoLeituraV2, modo: ModoDeLeituraV1): boolean {
  return validarMarcaGeradaV2(marca) && validarExecucaoLeituraV2(execucao) && mesmoModo(execucao.modo, modo) &&
    conferirMarcaNoModo(marca, modo) && marca.saliencia <= execucao.nivel_de_atencao_alvo;
}
/** Marca persistida de uma execução: camada, execução, versão e modo coincidem. */
export function conferirMarcaV2NaExecucao(marca: MarcaV2, execucao: ExecucaoLeituraV2): boolean {
  return validarMarcaV2(marca) && validarExecucaoLeituraV2(execucao) && marca.camada_id === execucao.id &&
    marca.execucao_id === execucao.id && marca.ancora.versao_id === execucao.versao_id && mesmoModo(marca.modo, execucao.modo);
}

export interface ConflitosDaCamada { camada_id: Id; pares: [Id, Id][] }
/**
 * Regra da camada editorial V2: marcas com função ≠ `nenhuma` e validade `resolvida` não se sobrepõem
 * no mesmo bloco **da mesma camada**. Devolve só as camadas com conflito, ordenadas por `camada_id`.
 * Uma camada é uma execução (ou um lote de importação): versão e modo únicos; divergência é erro.
 */
export function validarCamadaEditorialV2(marcas: readonly MarcaV2[]): ConflitosDaCamada[] {
  for (const marca of marcas) if (!validarMarcaV2(marca)) throw new Error('Marca inválida na camada.');
  if (new Set(marcas.map((marca) => marca.id)).size !== marcas.length) throw new Error('Marcas repetidas.');
  const camadas = new Map<Id, MarcaV2[]>();
  for (const marca of marcas) camadas.set(marca.camada_id, [...(camadas.get(marca.camada_id) ?? []), marca]);
  const resultado: ConflitosDaCamada[] = [];
  for (const [camada_id, daCamada] of [...camadas].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const [primeira] = daCamada;
    if (primeira && daCamada.some((marca) => marca.ancora.versao_id !== primeira.ancora.versao_id || !mesmoModo(marca.modo, primeira.modo))) {
      throw new Error(`Camada ${camada_id} mistura versões ou modos.`);
    }
    const ativas = daCamada.filter((marca) => marca.funcao !== 'nenhuma' && marca.validade === 'resolvida');
    const pares: [Id, Id][] = [];
    ativas.forEach((a, i) => {
      for (const b of ativas.slice(i + 1)) {
        if (a.ancora.bloco_id === b.ancora.bloco_id && a.ancora.inicio_utf16 < b.ancora.fim_utf16 && b.ancora.inicio_utf16 < a.ancora.fim_utf16) pares.push([a.id, b.id]);
      }
    });
    if (pares.length) resultado.push({ camada_id, pares });
  }
  return resultado;
}

/**
 * Leva uma marca V1 para a V2: modo `argumentativa@1`, saliência 2 e camada = `execucao_id`.
 * Sem `execucao_id` (importação sem execução), a camada precisa ser informada; informada e diferente da execução é erro.
 */
export function marcaV1ParaV2(marca: MarcaV1, camada_id?: Id): MarcaV2 {
  if (!validarMarca(marca)) throw new Error('Marca V1 inválida.');
  if (marca.execucao_id !== undefined && camada_id !== undefined && camada_id !== marca.execucao_id) {
    throw new Error('A camada de uma marca com execução é a própria execução.');
  }
  const camada = marca.execucao_id ?? camada_id;
  if (camada === undefined) throw new Error('Marca sem execução exige a camada (lote de importação).');
  const { funcao, comentario, ...resto } = structuredClone(marca);
  const v2: unknown = { ...resto, funcao, saliencia: 2, comentario, camada_id: camada, modo: { ...MODO_F1 } };
  if (!validarMarcaV2(v2)) throw new Error('Conversão produziu MarcaV2 inválida.');
  return v2;
}
const FUNCOES_V1: readonly string[] = ['tese', 'conceito', 'justificativa', 'nenhuma'] satisfies Funcao[];
const COMENTARIOS_V1: readonly string[] = ['AUTOR', 'LEITURA', 'INVESTIGAR', 'OBJECAO', 'CONEXAO'];
/**
 * Inversa exata de `marcaV1ParaV2` para consumidores V1: recusa o que a V1 não representa
 * (outro modo, saliência ≠ 2, função ou comentário fora da V1). Sem `execucao_id`, a camada se perde.
 */
export function marcaV2ParaV1(marca: MarcaV2): MarcaV1 {
  if (!validarMarcaV2(marca) || !mesmoModo(marca.modo, MODO_F1) || marca.saliencia !== 2 || !FUNCOES_V1.includes(marca.funcao) ||
    (marca.comentario !== null && !COMENTARIOS_V1.includes(marca.comentario.tipo))) throw new Error('MarcaV2 sem representação V1.');
  const copia: Partial<MarcaV2> = structuredClone(marca);
  delete copia.saliencia; delete copia.camada_id; delete copia.modo;
  const v1: unknown = copia;
  if (!validarMarca(v1)) throw new Error('Conversão produziu MarcaV1 inválida.');
  return v1;
}

export type DiagnosticoResposta = {
  caminho: string;
  codigo: 'bloco_fora_do_contexto' | 'citacao_ausente' | 'citacao_ambigua';
};
/**
 * Confere cada apoio e cada sugestão da resposta contra os blocos que o modelo recebeu.
 * Não resolve nada silenciosamente: citação ambígua ou ausente vira diagnóstico.
 */
export function diagnosticarRespostaGerada(resposta: RespostaGeradaV1, blocos: readonly Pick<Bloco, 'id' | 'texto'>[]): DiagnosticoResposta[] {
  const porId = new Map(blocos.map((bloco) => [bloco.id, bloco]));
  const diagnosticos: DiagnosticoResposta[] = [];
  const conferir = (caminho: string, blocoId: Id, citacao: string): void => {
    const bloco = porId.get(blocoId);
    if (!bloco) { diagnosticos.push({ caminho, codigo: 'bloco_fora_do_contexto' }); return; }
    const local = localizarCitacao(bloco, citacao);
    if (local.tipo === 'ausente') diagnosticos.push({ caminho, codigo: 'citacao_ausente' });
    if (local.tipo === 'ambigua') diagnosticos.push({ caminho, codigo: 'citacao_ambigua' });
  };
  resposta.pontos.forEach((ponto, i) => ponto.apoios.forEach((apoio, j) => conferir(`/pontos/${i}/apoios/${j}`, apoio.bloco_id, apoio.citacao)));
  resposta.sugestoes_de_conexao.forEach((sugestao, i) => conferir(`/sugestoes_de_conexao/${i}`, sugestao.destino_bloco_id, sugestao.citacao));
  return diagnosticos;
}

/**
 * Única transição de estado de uma conexão: uma sugestão da IA decidida pelo leitor.
 * Decisões são finais nesta versão; conexão do leitor já nasce aceita. Aceita V1 ou V2 e devolve a mesma versão.
 */
export function decidirConexao<T extends ConexaoV1 | ConexaoV2>(conexao: T, estado: 'aceita' | 'rejeitada', decidida_em: string): T {
  const validar = (valor: unknown): valor is T => conexao.versao === 2 ? validarConexaoV2(valor) : validarConexao(valor);
  if (!validar(conexao) || conexao.autor !== 'ia' || conexao.estado !== 'sugerida') throw new Error('Só uma sugestão da IA pode ser decidida.');
  const decidida: unknown = { ...structuredClone(conexao), estado, decidida_em };
  if (!validar(decidida)) throw new Error('Decisão inválida.');
  return decidida;
}
