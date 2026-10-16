/**
 * O que a pessoa lê quando algo falha (U-04): uma frase em português, nunca o código interno do serviço
 * (`falha_interna`) nem a mensagem técnica do navegador ("Failed to fetch"). O código continua no erro e no
 * registro do serviço; aqui só se escolhe o texto da tela.
 */
import { ErroDaApi } from './api';

export const SEM_CONEXAO = 'Não foi possível falar com o Margem. Confira se ele está aberto e tente novamente.';
export const FALHA_DO_SERVICO = 'O Margem não conseguiu concluir agora. Tente novamente em instantes.';

/** Códigos do serviço com uma frase própria; os outros caem no padrão de quem chama. */
const POR_CODIGO: Readonly<Record<string, string>> = {
  falha_interna: FALHA_DO_SERVICO,
  servico_indisponivel: FALHA_DO_SERVICO,
  versao_inexistente: 'Esta versão do texto não existe mais. Volte à biblioteca e abra o documento de novo.',
  capitulo_inexistente: 'Este capítulo não existe nesta versão do texto.',
  documento_inexistente: 'Este documento não está mais na biblioteca.',
  nao_encontrado: 'Não encontramos o que você pediu. Talvez tenha sido apagado.',
};

/** Parece um código (`falha_interna`, `Not Found`) ou texto técnico em inglês, não uma frase para quem lê. */
function pareceTecnico(texto: string): boolean {
  const limpo = texto.trim();
  if (limpo === '') return true;
  if (/^[a-z0-9]+(?:_[a-z0-9]+)*$/i.test(limpo)) return true;
  return /\b(?:failed|fetch|network|error|unexpected|undefined|null|cannot|module|import|load|abort|timeout|internal|server|not found|bad request)\b/i.test(limpo)
    && !/[áàâãéêíóôõúç]/i.test(limpo);
}

/** A falha veio da rede (serviço fora do ar, reiniciando, conexão recusada), não de uma resposta. */
function deRede(falha: unknown): boolean {
  if (!(falha instanceof Error)) return false;
  if (falha.name === 'AbortError') return false;
  return falha instanceof TypeError && /fetch|network|load failed|conex/i.test(falha.message);
}

/**
 * A frase da tela para uma falha qualquer. `padrao` é o que dizer quando a falha não traz nada aproveitável
 * (por exemplo, "Não foi possível carregar este texto.").
 */
export function mensagemDeErro(falha: unknown, padrao: string): string {
  if (falha instanceof ErroDaApi) {
    const propria = POR_CODIGO[falha.codigo];
    if (falha.detalhe !== undefined && falha.status < 500 && !pareceTecnico(falha.detalhe)) return falha.detalhe;
    if (propria !== undefined) return propria;
    if (falha.status >= 500) return FALHA_DO_SERVICO;
    return padrao;
  }
  if (deRede(falha)) return SEM_CONEXAO;
  if (falha instanceof Error && !(falha instanceof TypeError) && !(falha instanceof SyntaxError) && !pareceTecnico(falha.message)) return falha.message;
  return padrao;
}
