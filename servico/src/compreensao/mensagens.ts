/** Mensagens para quem lê sobre a preparação da leitura (v0.1). Sem dependências: a biblioteca também as usa. */

/** Frase para quem lê, a partir do código de falha do job (nunca o stderr do Codex). */
export function mensagemDaFalha(codigo: string | null): string {
  switch (codigo) {
    case 'processo': return 'O Codex parou com erro.';
    case 'timeout': return 'O Codex demorou mais que o prazo.';
    case 'cota': return 'A cota do Codex acabou por agora.';
    case 'auth': return 'O Codex pediu para entrar de novo na conta.';
    case 'schema': case 'json_invalido': return 'A resposta do Codex veio fora do formato.';
    case 'tentativas_esgotadas': return 'O trabalho falhou várias vezes seguidas.';
    case 'cancelado': return 'A preparação foi cancelada.';
    default: return 'Algo falhou na preparação.';
  }
}

