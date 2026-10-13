import type { AncoraV1, AnotacaoV1, ConexaoV1, ConexaoV2, ConversaV1, ConversaV2, MarcaGeradaV2, MarcaV2, ModoDeLeituraV1 } from './tipos';
import { regrasAncora, regrasMarcaGerada, regrasSubfaixas } from './regras';

/** Limites em unidades UTF-16, a mesma unidade dos offsets (o `maxLength` do Ajv conta code points). */
export const LIMITE_TEXTO_ANOTACAO = 8000;
export const LIMITE_TEXTO_MENSAGEM_LEITOR = 8000;
/** O autor humano: `pedro` nos contratos V1, `leitor` nos V2 (J101). */
function autorHumano(autor: string): boolean { return autor === 'leitor' || autor === 'pedro'; }
export const LIMITE_TEXTO_MENSAGEM_IA = 20000;

/** Instante em milissegundos; o formato RFC 3339 já foi conferido pelo schema. */
function instante(data: string): number { return Date.parse(data); }
function unicos(valores: readonly string[]): boolean { return new Set(valores).size === valores.length; }
export function mesmoIntervalo(a: AncoraV1, b: AncoraV1): boolean {
  return a.versao_id === b.versao_id && a.bloco_id === b.bloco_id && a.inicio_utf16 === b.inicio_utf16 && a.fim_utf16 === b.fim_utf16;
}

export function regrasModo(modo: ModoDeLeituraV1): boolean {
  const { '1': n1, '2': n2, '3': n3 } = modo.saliencia.alvo_por_nivel;
  return unicos(modo.funcoes.map((funcao) => funcao.chave)) && unicos(modo.funcoes.map((funcao) => funcao.rotulo)) &&
    unicos(modo.funcoes.map((funcao) => funcao.cor.claro)) && unicos(modo.funcoes.map((funcao) => funcao.cor.escuro)) &&
    n1 <= n2 && n2 <= n3;
}
export function regrasMarcaGeradaV2(marca: MarcaGeradaV2): boolean { return regrasMarcaGerada(marca); }
export function regrasMarcaV2(marca: MarcaV2): boolean {
  return regrasAncora(marca.ancora) && regrasSubfaixas(marca.subfaixas, marca.ancora) &&
    (marca.execucao_id === undefined || marca.execucao_id === marca.camada_id);
}
export function regrasAnotacao(anotacao: AnotacaoV1): boolean {
  return regrasAncora(anotacao.ancora) && anotacao.ancora.versao_id === anotacao.versao_id &&
    anotacao.texto.length <= LIMITE_TEXTO_ANOTACAO && instante(anotacao.criada_em) <= instante(anotacao.atualizada_em) &&
    // A revisão do Codex acontece entre a criação e a última atualização da nota.
    (anotacao.revisao === undefined || (instante(anotacao.criada_em) <= instante(anotacao.revisao.em)
      && instante(anotacao.revisao.em) <= instante(anotacao.atualizada_em) && anotacao.revisao.texto_anterior.length <= LIMITE_TEXTO_ANOTACAO));
}
export function regrasConversa(conversa: ConversaV1 | ConversaV2): boolean {
  const { mensagens } = conversa;
  if (!regrasAncora(conversa.ancora) || conversa.ancora.versao_id !== conversa.versao_id) return false;
  if (mensagens[0] === undefined || !autorHumano(mensagens[0].autor) || !unicos(mensagens.map((mensagem) => mensagem.id))) return false;
  if (instante(conversa.criada_em) > instante(mensagens[0].criada_em)) return false;
  return mensagens.every((mensagem, indice) => {
    const anterior = mensagens[indice - 1];
    if (anterior && instante(anterior.criada_em) > instante(mensagem.criada_em)) return false;
    if (mensagem.autor !== 'ia') return mensagem.texto.length <= LIMITE_TEXTO_MENSAGEM_LEITOR;
    const blocos = mensagem.contexto ? new Set(mensagem.contexto.blocos) : undefined;
    return mensagem.texto.length <= LIMITE_TEXTO_MENSAGEM_IA && mensagem.citacoes.every((citacao) =>
      regrasAncora(citacao) && citacao.versao_id === conversa.versao_id && (!blocos || blocos.has(citacao.bloco_id)));
  });
}
export function regrasConexao(conexao: ConexaoV1 | ConexaoV2): boolean {
  if (!regrasAncora(conexao.origem)) return false;
  if (conexao.destino.tipo === 'trecho' && (!regrasAncora(conexao.destino.ancora) || mesmoIntervalo(conexao.origem, conexao.destino.ancora))) return false;
  if (conexao.decidida_em === undefined) return true;
  const criada = instante(conexao.criada_em);
  const decidida = instante(conexao.decidida_em);
  return autorHumano(conexao.autor) ? decidida === criada : decidida >= criada;
}
