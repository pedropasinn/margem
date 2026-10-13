/**
 * CSV das respostas e dos comentários de uma sala. UTF-8 com BOM (o Excel o abre com acentos),
 * vírgula, aspas duplas quando preciso e proteção contra fórmula: célula que começa com
 * `= + - @`, tabulação ou retorno ganha um apóstrofo na frente.
 */
import type { RelatorioDaSala } from './relatorio.js';

export function celula(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\r\n;]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

function linhas(tabela: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `\uFEFF${tabela.map((linha) => linha.map(celula).join(',')).join('\r\n')}\r\n`;
}

export function csvDasRespostas(relatorio: RelatorioDaSala): string {
  const { sala, documentos } = relatorio;
  const cabecalho: string[] = ['Nome', 'E-mail', 'Estado', 'Enviada em', 'Atualizada em', 'Comentários nos trechos'];
  for (const pergunta of sala.formulario.geral) cabecalho.push(pergunta.enunciado);
  for (const documento of documentos) for (const pergunta of sala.formulario.por_documento) cabecalho.push(`${documento.titulo} — ${pergunta.enunciado}`);
  const corpo = relatorio.testadores.map((testador) => {
    const resposta = testador.resposta;
    const linha: (string | number | null)[] = [testador.nome, testador.email, resposta?.estado ?? 'sem resposta',
      resposta?.enviada_em ?? null, resposta?.atualizada_em ?? null, testador.comentarios];
    for (const pergunta of sala.formulario.geral) linha.push(resposta?.geral[pergunta.id] ?? null);
    for (const documento of documentos) for (const pergunta of sala.formulario.por_documento) linha.push(resposta?.por_documento[documento.id]?.[pergunta.id] ?? null);
    return linha;
  });
  return linhas([cabecalho, ...corpo]);
}

export function csvDosComentarios(relatorio: RelatorioDaSala): string {
  return linhas([
    ['Testador', 'Documento', 'Trecho', 'Comentário', 'Criado em', 'Documento (id)', 'Versão (id)', 'Bloco (id)'],
    ...relatorio.comentarios.map((comentario) => [comentario.testador, comentario.documento_titulo, comentario.citacao, comentario.texto,
      comentario.criado_em, comentario.documento_id, comentario.versao_id, comentario.bloco_id]),
  ]);
}
