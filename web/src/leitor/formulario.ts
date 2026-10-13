export function campoTexto(dados: FormData, chave: string): string {
  const valor = dados.get(chave);
  return typeof valor === 'string' ? valor : '';
}
