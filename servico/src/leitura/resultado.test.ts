import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { validarMarca } from '@margem/contratos';
import { canonicoDeTeste, caminhoDoRoteiro, contadorDeIds, idTeste } from '../../testes/apoio.js';
import { interpretarSaida, lerSaidaDoLeitor, SaidaInvalida, type SaidaDoLeitor } from './resultado.js';

const canonico = canonicoDeTeste({
  blocos: [
    { tipo: 'paragrafo', texto: 'A hipótese vale. A hipótese vale.' },
    { tipo: 'paragrafo', texto: 'Um trecho sobreposto começa aqui e termina ali.' },
    { tipo: 'paragrafo', texto: 'Bloco fora da parte.' },
  ],
});

const parte = { blocos_responsaveis: [idTeste('B', 0), idTeste('B', 1)] };
const contexto = {
  versao_id: idTeste('V', 1), execucao_id: idTeste('E', 1), job_id: idTeste('J', 1),
  agora: () => new Date('2026-09-20T12:00:00.000Z'),
};

function saidaDoRoteiro(nome: string): SaidaDoLeitor {
  const roteiro = JSON.parse(readFileSync(caminhoDoRoteiro(nome), 'utf8')) as { passos: { conteudo: unknown }[] };
  return lerSaidaDoLeitor(roteiro.passos[0]?.conteudo);
}

test('o roteiro de problemas obedece ao schema versionado do prompt', () => {
  expect(saidaDoRoteiro('leitor-problemas').marcas).toHaveLength(6);
});

test('saída fora do schema é recusada com o problema à vista', () => {
  expect(() => lerSaidaDoLeitor({ marcas: [] })).toThrow(SaidaInvalida);
  try {
    lerSaidaDoLeitor({ marcas: [{ bloco_id: 'x' }], recuperacao: [], mapa_da_secao: [], resumo_da_parte: 'r', limites: [], leitura_integral: true });
  } catch (erro) {
    expect(erro).toBeInstanceOf(SaidaInvalida);
    expect((erro as SaidaInvalida).problemas.join(' ')).toMatch(/bloco_id|required/);
  }
});

test('citação ambígua é rejeitada e visível, nunca resolvida na primeira ocorrência', () => {
  const resultado = interpretarSaida(canonico, parte, saidaDoRoteiro('leitor-problemas'), { ...contexto, novoId: contadorDeIds('M') });
  const ambigua = resultado.rejeitadas.find((item) => item.motivo === 'citacao_ambigua');
  expect(ambigua).toBeDefined();
  expect(ambigua?.citacao).toBe('A hipótese vale.');
  expect(ambigua?.detalhe).toContain('2 ocorrências');
  expect(resultado.marcas.some((marca) => marca.ancora.bloco_id === idTeste('B', 0))).toBe(false);
});

test('sobreposição editorial mantém a primeira e rejeita a segunda', () => {
  const resultado = interpretarSaida(canonico, parte, saidaDoRoteiro('leitor-problemas'), { ...contexto, novoId: contadorDeIds('M') });
  const primeira = resultado.marcas.find((marca) => marca.ancora.citacao === 'Um trecho sobreposto começa aqui');
  expect(primeira?.funcao).toBe('tese');
  const segunda = resultado.rejeitadas.find((item) => item.motivo === 'sobreposicao_editorial');
  expect(segunda?.citacao).toBe('sobreposto começa aqui e termina ali.');
  expect(segunda?.detalhe).toContain(primeira?.id ?? '');
  // `funcao: nenhuma` não disputa a camada das cores e sobrevive à sobreposição.
  expect(resultado.marcas.some((marca) => marca.funcao === 'nenhuma')).toBe(true);
});

test('bloco fora da parte e bloco inexistente são rejeitados com motivos distintos', () => {
  const resultado = interpretarSaida(canonico, parte, saidaDoRoteiro('leitor-problemas'), { ...contexto, novoId: contadorDeIds('M') });
  expect(resultado.rejeitadas.map((item) => item.motivo)).toEqual(expect.arrayContaining([
    'citacao_ambigua', 'sobreposicao_editorial', 'bloco_fora_da_parte', 'bloco_desconhecido',
  ]));
  expect(resultado.rejeitadas.find((item) => item.motivo === 'bloco_desconhecido')?.bloco_id).toBe(idTeste('B', 9));
});

test('sublinhado não localizado vira aviso, sem derrubar a marca', () => {
  const resultado = interpretarSaida(canonico, parte, saidaDoRoteiro('leitor-problemas'), { ...contexto, novoId: contadorDeIds('M') });
  expect(resultado.avisos).toEqual([{ indice: 5, motivo: 'sublinhar_nao_resolvido', termos: ['inexistente'] }]);
  expect(resultado.marcas.find((marca) => marca.funcao === 'nenhuma')?.subfaixas).toEqual([]);
});

test('as marcas saem resolvidas, visíveis, não avaliadas e com origem parte', () => {
  const resultado = interpretarSaida(canonico, parte, saidaDoRoteiro('leitor-problemas'), { ...contexto, novoId: contadorDeIds('M') });
  expect(resultado.marcas.length).toBeGreaterThan(0);
  for (const marca of resultado.marcas) {
    expect(validarMarca(marca)).toBe(true);
    expect(marca).toMatchObject({
      origem: 'parte', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada',
      execucao_id: contexto.execucao_id, job_id: contexto.job_id, criada_em: '2026-09-20T12:00:00.000Z',
    });
    const bloco = canonico.blocos.find((item) => item.id === marca.ancora.bloco_id);
    expect(bloco?.texto.slice(marca.ancora.inicio_utf16, marca.ancora.fim_utf16)).toBe(marca.ancora.citacao);
  }
  expect(resultado.limites).toEqual(['Bloco 3 chegou truncado.']);
  expect(resultado.leitura_integral).toBe(false);
});

test('subfaixas usam coordenadas do bloco e o sublinhado é resolvido dentro da citação', () => {
  const canonicoComSublinhado = canonicoDeTeste({
    blocos: [{ tipo: 'paragrafo', texto: 'Prefixo. Um conceito vale somente aqui.' }],
  });
  const saida: SaidaDoLeitor = {
    marcas: [{
      bloco_id: idTeste('B', 0), citacao: 'Um conceito vale somente aqui.', prefixo: 'Prefixo. ', sufixo: '',
      funcao: 'conceito', sublinhar: ['somente'], comentario: null,
    }],
    recuperacao: [], mapa_da_secao: [], resumo_da_parte: 'resumo', limites: [], leitura_integral: true,
  };
  const resultado = interpretarSaida(canonicoComSublinhado, { blocos_responsaveis: [idTeste('B', 0)] }, saida,
    { ...contexto, novoId: contadorDeIds('M') });
  const marca = resultado.marcas[0];
  expect(marca?.ancora.inicio_utf16).toBe(9);
  expect(marca?.subfaixas).toEqual([{ inicio_utf16: 26, fim_utf16: 33 }]);
  const texto = canonicoComSublinhado.blocos[0]?.texto ?? '';
  expect(texto.slice(26, 33)).toBe('somente');
});
