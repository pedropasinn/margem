import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { validarCanonico, validarPartes, type CanonicoV1 } from '@margem/contratos';
import { canonicoDeTeste, contadorDeIds, idTeste, material, textosDoPrompt, VERSOES } from '../../testes/apoio.js';
import { estimarTokens, planejarLeitura, TIPOS_ELEGIVEIS, UNIDADES_POR_TOKEN } from './partes.js';

const textos = textosDoPrompt();
const base = { execucao_id: idTeste('E', 1), versoes: VERSOES, textos };

function livroDeTeste(): CanonicoV1 {
  return canonicoDeTeste({
    titulo: 'Livro de teste',
    blocos: [
      { tipo: 'capitulo', texto: 'Capítulo um' },
      { tipo: 'paragrafo', texto: 'Abertura do primeiro capítulo, com a pergunta que organiza a leitura.' },
      { tipo: 'secao', texto: 'Primeira seção' },
      { tipo: 'paragrafo', texto: 'A primeira seção define o conceito que o restante do capítulo usa.' },
      { tipo: 'figura', texto: '' },
      { tipo: 'secao', texto: 'Segunda seção' },
      { tipo: 'paragrafo', texto: 'A segunda seção apresenta a evidência que sustenta a tese anunciada.' },
      { tipo: 'nota_rodape', texto: 'Nota de rodapé do capítulo um.' },
      { tipo: 'capitulo', texto: 'Capítulo dois' },
      { tipo: 'paragrafo', texto: 'O segundo capítulo retoma o conceito e acrescenta uma condição nova.' },
    ],
    secoes: [
      { nivel: 1, inicio: 0, fim: 7 },
      { nivel: 2, inicio: 2, fim: 4 },
      { nivel: 2, inicio: 5, fim: 7 },
      { nivel: 1, inicio: 8, fim: 9 },
    ],
  });
}

test('a estimativa de tokens usa a constante declarada', () => {
  expect(UNIDADES_POR_TOKEN).toBe(3.6);
  expect(estimarTokens(['abcdefg'])).toBe(Math.ceil(7 / 3.6));
  expect(estimarTokens([])).toBe(0);
});

test('um capítulo por parte quando cabe no teto, com títulos só como contexto', () => {
  const canonico = livroDeTeste();
  const plano = planejarLeitura(canonico, { ...base, novoId: contadorDeIds('P') });
  expect(plano.partes).toHaveLength(2);
  expect(plano.partes[0]?.blocos_responsaveis).toEqual([idTeste('B', 1), idTeste('B', 3), idTeste('B', 6), idTeste('B', 7)]);
  // `figura` não é elegível; os três títulos que cobrem a fatia entram como contexto.
  expect(plano.partes[0]?.blocos_contexto).toEqual([idTeste('B', 0), idTeste('B', 2), idTeste('B', 5)]);
  expect(plano.partes[1]?.blocos_responsaveis).toEqual([idTeste('B', 9)]);
  expect(plano.continuacoes.size).toBe(0);
  expect(validarPartes(plano.partes, undefined, canonico)).toBe(true);
});

test('cada bloco elegível tem exatamente uma parte responsável', () => {
  const canonico = livroDeTeste();
  for (const teto of [400, 40, 12, 6]) {
    const plano = planejarLeitura(canonico, { ...base, tamanho_parte_tokens: teto, novoId: contadorDeIds('P') });
    const responsaveis = plano.partes.flatMap((parte) => parte.blocos_responsaveis);
    const elegiveis = canonico.blocos.filter((bloco) => TIPOS_ELEGIVEIS.has(bloco.tipo)).map((bloco) => bloco.id);
    expect([...responsaveis].sort()).toEqual([...elegiveis].sort());
    expect(new Set(responsaveis).size).toBe(responsaveis.length);
    for (const parte of plano.partes) {
      expect(parte.blocos_contexto.some((id) => parte.blocos_responsaveis.includes(id))).toBe(false);
    }
    expect(validarPartes(plano.partes, undefined, canonico)).toBe(true);
  }
});

test('capítulo acima do teto é cortado em fronteira de seção, com os dois blocos anteriores de contexto', () => {
  const canonico = livroDeTeste();
  const plano = planejarLeitura(canonico, { ...base, tamanho_parte_tokens: 40, novoId: contadorDeIds('P') });
  const doCapituloUm = plano.partes.filter((parte) => parte.blocos_responsaveis.includes(idTeste('B', 1))
    || parte.blocos_responsaveis.includes(idTeste('B', 3)) || parte.blocos_responsaveis.includes(idTeste('B', 6)));
  expect(doCapituloUm.length).toBeGreaterThan(1);
  const segunda = doCapituloUm[1];
  const inicio = canonico.blocos.findIndex((bloco) => bloco.id === segunda?.blocos_responsaveis[0]);
  // O primeiro responsável de uma continuação é sempre um início de seção de nível 2.
  expect(canonico.secoes.some((secao) => secao.nivel >= 2
    && canonico.blocos.findIndex((bloco) => bloco.id === secao.bloco_inicio) <= inicio)).toBe(true);
  for (const anterior of [inicio - 2, inicio - 1]) {
    const bloco = canonico.blocos[anterior];
    if (bloco) expect(segunda?.blocos_contexto).toContain(bloco.id);
  }
  expect(plano.continuacoes.has(segunda?.ordem ?? -1)).toBe(true);
});

test('modo sequencial marca também a passagem entre capítulos como continuação', () => {
  const canonico = livroDeTeste();
  const plano = planejarLeitura(canonico, { ...base, modo: 'sequencial', novoId: contadorDeIds('P') });
  expect([...plano.continuacoes]).toEqual([1]);
});

test('canônico dos contratos, sem seções declaradas, vira uma parte só', () => {
  const canonico: unknown = JSON.parse(readFileSync(
    new URL('../../../contratos/casos/Canonico/valido-unicode.json', import.meta.url), 'utf8'));
  if (!validarCanonico(canonico)) throw new Error('Caso dos contratos inválido.');
  const plano = planejarLeitura(canonico, { ...base, novoId: contadorDeIds('P') });
  expect(plano.partes).toHaveLength(1);
  expect(plano.partes[0]?.blocos_responsaveis).toEqual(canonico.blocos.map((bloco) => bloco.id));
  expect(validarPartes(plano.partes, undefined, canonico)).toBe(true);
});

test('teto inválido é recusado', () => {
  expect(() => planejarLeitura(livroDeTeste(), { ...base, tamanho_parte_tokens: 0 })).toThrow('inteiro positivo');
});

const mixtape = material('corpus_principal');

describe.skipIf(mixtape === undefined)('capítulo 3 do Mixtape canonizado pelo motor', () => {
  test('o plano cobre todos os blocos elegíveis do capítulo', () => {
    if (!mixtape) throw new Error('inalcançável');
    const raiz = new URL('../../../', import.meta.url).pathname;
    const destino = join(mkdtempSync(join(tmpdir(), 'margem-j06-')), 'saida');
    try {
      execFileSync(join(raiz, 'motor/.venv/bin/python'),
        ['-m', 'margem_motor.ingest', '--entrada', mixtape, '--formato', 'pdf',
          '--paginas', '108-130', '--idioma', 'en', '--saida', destino],
        { cwd: join(raiz, 'motor'), stdio: ['ignore', 'ignore', 'pipe'] });
      const canonico: unknown = JSON.parse(readFileSync(join(destino, 'canonico.json'), 'utf8'));
      if (!validarCanonico(canonico)) throw new Error('O motor produziu canônico inválido.');
      const plano = planejarLeitura(canonico, { ...base, novoId: contadorDeIds('P') });
      const responsaveis = plano.partes.flatMap((parte) => parte.blocos_responsaveis);
      const elegiveis = canonico.blocos.filter((bloco) => TIPOS_ELEGIVEIS.has(bloco.tipo));
      expect(new Set(responsaveis).size).toBe(responsaveis.length);
      expect([...responsaveis].sort()).toEqual(elegiveis.map((bloco) => bloco.id).sort());
      expect(validarPartes(plano.partes, undefined, canonico)).toBe(true);
      // O capítulo inteiro cabe em 45 mil tokens: uma parte por capítulo, como no Mixtape real.
      expect(estimarTokens(canonico.blocos.map((bloco) => bloco.texto))).toBeLessThan(45_000);
      const comCorte = planejarLeitura(canonico, { ...base, tamanho_parte_tokens: 4_000, novoId: contadorDeIds('P') });
      expect(comCorte.partes.length).toBeGreaterThan(1);
      expect(validarPartes(comCorte.partes, undefined, canonico)).toBe(true);
      expect([...comCorte.continuacoes].length).toBe(comCorte.partes.length - 1);
    } finally {
      rmSync(join(destino, '..'), { recursive: true, force: true });
    }
  }, 120_000);
});
