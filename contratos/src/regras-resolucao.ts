import type { ResolucaoV1, ResolucaoV2 } from './tipos';

/**
 * Invariantes da sessão de resolução (J34): o recorte cabe na página; o trecho é da versão da sessão;
 * a resolução e a execução chegam juntas; as perguntas vêm depois da resolução, alternando leitor e IA,
 * sem voltar no tempo.
 */
export function regrasResolucao(sessao: ResolucaoV1 | ResolucaoV2): boolean {
  const humano = sessao.versao === 1 ? 'pedro' : 'leitor';
  const { origem } = sessao;
  if (origem.tipo === 'recorte') {
    const { x, y, largura, altura } = origem.retangulo;
    if (largura <= 0 || altura <= 0 || x + largura > 1 + 1e-9 || y + altura > 1 + 1e-9) return false;
  } else if (origem.ancora.versao_id !== sessao.versao_id) return false;
  if ((sessao.resolucao === null) !== (sessao.execucao === null)) return false;
  if (sessao.mensagens.length > 0 && sessao.resolucao === null) return false;
  const ids = new Set(sessao.mensagens.map((mensagem) => mensagem.id));
  if (ids.size !== sessao.mensagens.length) return false;
  let antes = Date.parse(sessao.criada_em);
  return sessao.mensagens.every((mensagem, indice) => {
    const quando = Date.parse(mensagem.criada_em);
    const emOrdem = mensagem.autor === (indice % 2 === 0 ? humano : 'ia') && quando >= antes;
    antes = quando;
    return emOrdem;
  });
}
