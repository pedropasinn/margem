import { expect, test } from 'vitest';
import { resumirAvisos } from './avisos.js';
import { avisosDosLimites, resumirLimites } from './limites.js';

const equacao = (pagina: number) => `conteudo_nao_textual: Equacao na página PDF ${String(pagina)}: texto linearizado parcial; consultar a página inteira (110 dpi).`;

test('21 equações numa lista de exercícios são informação, não aviso', () => {
  const limites = Array.from({ length: 21 }, () => equacao(1));
  expect(avisosDosLimites(limites)).toEqual([]);
  expect(resumirLimites(limites)).toEqual([{
    nivel: 'info', codigo: 'conteudo_visual', quantidade: 21,
    mensagem: '21 equações na página 1: o texto fica para busca e marcas, e o original continua à vista.',
  }]);
  // O job da canonização (inclusive o gravado antes desta regra) termina sem "concluído com avisos".
  expect(resumirAvisos('canonizar', limites.map((mensagem) => ({ nivel: 'aviso', codigo: 'limite_da_canonizacao', mensagem })))).toEqual([]);
});

test('tabelas e figuras em várias páginas viram uma frase por tipo', () => {
  const limites = [equacao(1), equacao(3), 'conteudo_nao_textual: Tabela na página PDF 2: texto linearizado parcial.', equacao(5), equacao(7), equacao(9)];
  expect(resumirLimites(limites).map((item) => item.mensagem)).toEqual([
    '5 equações em 5 páginas: o texto fica para busca e marcas, e o original continua à vista.',
    'Uma tabela na página 2: o texto fica para busca e marcas, e o original continua à vista.',
  ]);
});

test('o que se perdeu vira aviso agrupado, com frase humana, antes das informações', () => {
  const limites = [
    'pagina_repetida: Página PDF 3 idêntica à 2; omitida (texto e pixels).',
    'geometria_nao_alinhada: Bloco b1: 4 caracteres não brancos sem posição confiável.',
    'geometria_nao_alinhada: Bloco b2: 2 caracteres não brancos sem posição confiável.',
    'estrofe_recusada: Linhas 3–9: recuo inconsistente.',
    'algo_novo: o motor declarou um limite que o serviço ainda não conhece.',
  ];
  const resumo = resumirLimites(limites);
  expect(resumo.map((item) => [item.nivel, item.codigo])).toEqual([
    ['aviso', 'texto_sem_posicao'], ['aviso', 'versos_como_prosa'], ['aviso', 'limite_da_canonizacao'], ['info', 'paginas_repetidas'],
  ]);
  expect(resumo[0]!.mensagem).toBe('Em 2 trechos, as marcas podem ficar um pouco fora do lugar no PDF.');
  const avisos = resumirAvisos('canonizar', limites.map((mensagem) => ({ nivel: 'aviso' as const, codigo: 'limite_da_canonizacao', mensagem })));
  expect(avisos.map((aviso) => aviso.codigo)).toEqual(['texto_sem_posicao', 'versos_como_prosa', 'limite_da_canonizacao']);
  expect(avisos.every((aviso) => !aviso.mensagem.includes('_'))).toBe(true);
});

test('página sem texto não duplica o aviso: a página do documento já oferece "transcrever"', () => {
  expect(avisosDosLimites(['sem_texto: Página PDF 4 sem texto extraível; OCR e visão fora de F1.'])).toEqual([]);
});
