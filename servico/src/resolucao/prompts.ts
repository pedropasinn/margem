/**
 * Prompts da resolução de exercícios (J34): `resolver-exercicio@3` (a matemática em LaTeX, com o texto neutro do J101; o @1, em Unicode, e o @2 ficam para as resoluções antigas) e `explicar-resolucao@2`. O texto do
 * recorte, a resolução e as perguntas entram cercados; os schemas saem de `prompts/` sem mudança.
 */
import type { ResolucaoGeradaV1, ResolucaoV2 } from '@margem/contratos';
import { cercar, corpoDoModelo, ehObjeto, lerPrompt, preencher } from '../leitura/v2/prompt.js';

export const VERSAO_PROMPT_RESOLVER = 'resolver-exercicio@3';
export const VERSAO_PROMPT_EXPLICAR = 'explicar-resolucao@2';

export interface PromptDaResolucao { prompt: string; schema: Record<string, unknown> }

function schema(nome: string): Record<string, unknown> {
  const valor: unknown = JSON.parse(lerPrompt(`${nome}.schema.json`));
  if (!ehObjeto(valor)) throw new Error(`Schema ${nome} não é um objeto.`);
  return valor;
}
const SEM_IMAGEM = ' (nesta execução a imagem não pôde ir junto: trabalhe só com o texto e diga em `observacao` o que ficou incerto)';

export function montarPromptDeResolucao(sessao: ResolucaoV2, documento: string, comImagem: boolean): PromptDaResolucao {
  const pagina = sessao.origem.tipo === 'recorte' ? String(sessao.origem.pagina) : '—';
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_RESOLVER}.md`)), {
      sem_imagem: comImagem ? '' : SEM_IMAGEM,
      documento,
      pagina,
      texto: sessao.texto_extraido.trim() === '' ? '(vazio: o recorte não tinha camada de texto)' : cercar(sessao.texto_extraido),
    }),
    schema: schema(VERSAO_PROMPT_RESOLVER),
  };
}

/** A resolução como o modelo a leu, em texto: itens, passos numerados, resposta. */
export function resolucaoEmTexto(resolucao: ResolucaoGeradaV1): string {
  return resolucao.itens.map((item) => [
    `Item ${item.rotulo || '(único)'}: ${item.enunciado}`,
    `Estratégia: ${item.estrategia}`,
    ...item.passos.map((passo, indice) => `Passo ${String(indice + 1)}: ${passo.texto}${passo.calculo ? `\n    ${passo.calculo}` : ''}`),
    `Resposta: ${item.resposta}`,
    ...(item.verificacao ? [`Verificação: ${item.verificacao}`] : []),
  ].join('\n')).join('\n\n');
}

export function montarPromptDeExplicacao(sessao: ResolucaoV2, perguntaId: string, comImagem: boolean): PromptDaResolucao {
  if (!sessao.resolucao) throw new Error('Pergunta sobre uma resolução que ainda não existe.');
  const ate = sessao.mensagens.findIndex((mensagem) => mensagem.id === perguntaId);
  const pergunta = sessao.mensagens[ate];
  if (pergunta?.autor !== 'leitor') throw new Error('Pergunta inexistente na sessão.');
  const historico = sessao.mensagens.slice(0, ate)
    .map((mensagem) => `${mensagem.autor === 'leitor' ? 'Leitor' : 'Professor'}: ${mensagem.texto}`).join('\n\n');
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_EXPLICAR}.md`)), {
      sem_imagem: comImagem ? '' : SEM_IMAGEM.replace('diga em `observacao`', 'diga no texto'),
      enunciado: cercar(sessao.resolucao.enunciado),
      resolucao: cercar(resolucaoEmTexto(sessao.resolucao)),
      historico: historico === '' ? '(esta é a primeira pergunta)' : cercar(historico),
      pergunta: cercar(pergunta.texto),
    }),
    schema: schema(VERSAO_PROMPT_EXPLICAR),
  };
}
