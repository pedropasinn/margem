import { describe, expect, test } from 'vitest';
import { conferirAncora, validarAncora } from '@margem/contratos';
import { ancoraDeSelecao, reancorar, resolverCitacao, resolverSubfaixas } from './ancoras';
import { blocoDeVersao, marca, VERSAO } from '../testes/apoio';

describe('resolverCitacao', () => {
  test('resolve uma citação literal única', () => {
    const bloco = blocoDeVersao('Um texto íntegro.');
    const resultado = resolverCitacao(bloco, { citacao: 'texto' });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.ancora.inicio_utf16).toBe(3);
    expect(resultado.ancora.fim_utf16).toBe(8);
    expect(resultado.ancora.versao_id).toBe(VERSAO);
    expect(validarAncora(resultado.ancora)).toBe(true);
    expect(conferirAncora(bloco, resultado.ancora)).toBe(true);
  });

  test('citação repetida nunca vira a primeira ocorrência em silêncio', () => {
    const bloco = blocoDeVersao('o efeito causal e depois o efeito causal de novo');
    const resultado = resolverCitacao(bloco, { citacao: 'efeito causal' });
    expect(resultado).toMatchObject({ ok: false, motivo: 'ambigua', ocorrencias: 2 });
  });

  test('desambigua com prefixo e sufixo', () => {
    const bloco = blocoDeVersao('o efeito causal e depois o efeito causal de novo');
    const resultado = resolverCitacao(bloco, { citacao: 'efeito causal', sufixo: ' de novo' });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.ancora.inicio_utf16).toBe('o efeito causal e depois o '.length);
    expect(conferirAncora(bloco, resultado.ancora)).toBe(true);
  });

  test('sugere o menor contexto que tornaria a citação única', () => {
    const bloco = blocoDeVersao('a casa azul e a casa verde');
    const resultado = resolverCitacao(bloco, { citacao: 'casa' });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    const sugestao = resultado.sugestao_de_contexto;
    expect(sugestao).toBeDefined();
    if (!sugestao) return;
    expect(sugestao.prefixo.length + sugestao.sufixo.length).toBeLessThanOrEqual(2);
    const confirmada = resolverCitacao(bloco, { citacao: 'casa', ...sugestao });
    expect(confirmada.ok).toBe(true);
  });

  test('não sugere contexto quando as ocorrências são indistinguíveis dentro do limite', () => {
    const bloco = blocoDeVersao('ab'.repeat(200));
    const resultado = resolverCitacao(bloco, { citacao: 'ab' });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.ocorrencias).toBe(200);
    expect(resultado.sugestao_de_contexto).toBeUndefined();
  });

  test('citação ausente e citação vazia têm motivos próprios', () => {
    const bloco = blocoDeVersao('Um texto íntegro.');
    expect(resolverCitacao(bloco, { citacao: 'ausente' })).toEqual({ ok: false, motivo: 'ausente', ocorrencias: 0 });
    expect(resolverCitacao(bloco, { citacao: 'texto', prefixo: 'nada' })).toEqual({ ok: false, motivo: 'ausente', ocorrencias: 0 });
    expect(resolverCitacao(bloco, { citacao: '' })).toEqual({ ok: false, motivo: 'vazia', ocorrencias: 0 });
  });

  test('conta pares substitutos e não normaliza acentos combinados nem ligaturas', () => {
    const bloco = blocoDeVersao('Um 🧭 com cafe\u0301 e ﬁm.');
    const emoji = resolverCitacao(bloco, { citacao: '🧭' });
    expect(emoji.ok).toBe(true);
    if (emoji.ok) expect([emoji.ancora.inicio_utf16, emoji.ancora.fim_utf16]).toEqual([3, 5]);
    expect(resolverCitacao(bloco, { citacao: 'café' }).ok).toBe(false);
    expect(resolverCitacao(bloco, { citacao: 'cafe\u0301' }).ok).toBe(true);
    expect(resolverCitacao(bloco, { citacao: 'fi' }).ok).toBe(false);
  });

  test('não atravessa a fronteira de blocos', () => {
    const primeiro = blocoDeVersao('fim do primeiro', 1);
    const segundo = blocoDeVersao('começo do segundo', 2);
    expect(resolverCitacao(primeiro, { citacao: 'primeiro\n\ncomeço' }).ok).toBe(false);
    expect(resolverCitacao(segundo, { citacao: 'primeiro\n\ncomeço' }).ok).toBe(false);
  });
});

describe('resolverSubfaixas', () => {
  const bloco = blocoDeVersao('A hipótese só vale se o instrumento for exógeno e relevante.');
  const ancora = ancoraDeSelecao(bloco, 2, 59);

  test('resolve termos em coordenadas do bloco, ordenados', () => {
    const { subfaixas, nao_resolvidas } = resolverSubfaixas(bloco, ancora, ['relevante', 'exógeno']);
    expect(nao_resolvidas).toEqual([]);
    expect(subfaixas).toEqual([
      { inicio_utf16: bloco.texto.indexOf('exógeno'), fim_utf16: bloco.texto.indexOf('exógeno') + 7 },
      { inicio_utf16: bloco.texto.indexOf('relevante'), fim_utf16: bloco.texto.indexOf('relevante') + 9 },
    ]);
  });

  test('termo ambíguo, ausente ou vazio não é resolvido', () => {
    const { subfaixas, nao_resolvidas } = resolverSubfaixas(bloco, ancora, ['e', 'jamais', '']);
    expect(subfaixas).toEqual([]);
    expect(nao_resolvidas).toEqual([
      { texto: 'e', motivo: 'ambigua' },
      { texto: 'jamais', motivo: 'ausente' },
      { texto: '', motivo: 'vazia' },
    ]);
  });

  test('sobreposição mantém a primeira e registra a segunda', () => {
    const { subfaixas, nao_resolvidas } = resolverSubfaixas(bloco, ancora, ['instrumento for', 'for exógeno']);
    expect(subfaixas).toHaveLength(1);
    expect(subfaixas[0]?.inicio_utf16).toBe(bloco.texto.indexOf('instrumento for'));
    expect(nao_resolvidas).toEqual([{ texto: 'for exógeno', motivo: 'sobreposta' }]);
  });

  test('recusa termo que cortaria um par substituto', () => {
    const comEmoji = blocoDeVersao('bússola 🧭 aqui');
    const inteira = ancoraDeSelecao(comEmoji, 0, comEmoji.texto.length);
    const meio = '🧭'.slice(0, 1);
    expect(resolverSubfaixas(comEmoji, inteira, [meio]).nao_resolvidas).toEqual([{ texto: meio, motivo: 'fronteira' }]);
  });
});

describe('ancoraDeSelecao', () => {
  test('amplia o contexto até a citação ficar única', () => {
    const arredores = (marca: string): string => `${'p'.repeat(20)}${marca}${'x'.repeat(40)}alvo${'y'.repeat(60)}`;
    const texto = `${arredores('q')} | ${arredores('r')}`;
    const bloco = blocoDeVersao(texto);
    const ancora = ancoraDeSelecao(bloco, texto.lastIndexOf('alvo'), texto.lastIndexOf('alvo') + 4);
    expect(ancora.prefixo.length).toBe(64);
    expect(conferirAncora(bloco, ancora)).toBe(true);
    const confirmada = resolverCitacao(bloco, { citacao: 'alvo', prefixo: ancora.prefixo, sufixo: ancora.sufixo });
    expect(confirmada.ok).toBe(true);
  });

  test('para no máximo de 256 unidades quando a ambiguidade não se resolve', () => {
    const bloco = blocoDeVersao('ab'.repeat(400));
    const ancora = ancoraDeSelecao(bloco, 400, 402);
    expect(ancora.prefixo.length).toBe(256);
    expect(ancora.sufixo.length).toBe(256);
    expect(conferirAncora(bloco, ancora)).toBe(true);
  });

  test('não corta pares substitutos ao recortar o contexto', () => {
    const bloco = blocoDeVersao(`${'🧭'.repeat(30)}alvo${'🧭'.repeat(30)}`);
    const ancora = ancoraDeSelecao(bloco, 60, 64, 31);
    expect(conferirAncora(bloco, ancora)).toBe(true);
    expect(ancora.prefixo.startsWith('🧭')).toBe(true);
  });

  test('aceita contexto zero quando a citação já é única', () => {
    const bloco = blocoDeVersao('uma só vez');
    expect(ancoraDeSelecao(bloco, 4, 6, 0)).toMatchObject({ prefixo: '', sufixo: '', citacao: 'só' });
  });

  test('recusa seleção vazia, fora do bloco, com contexto inválido ou cortando par substituto', () => {
    const bloco = blocoDeVersao('um 🧭 aqui');
    expect(() => ancoraDeSelecao(bloco, 3, 3)).toThrow(/não vazia/);
    expect(() => ancoraDeSelecao(bloco, 0, 99)).toThrow(/fora do texto/);
    expect(() => ancoraDeSelecao(bloco, 3, 4)).toThrow(/par substituto/);
    expect(() => ancoraDeSelecao(bloco, 0, 3, -1)).toThrow(/Contexto/);
  });
});

describe('reancorar', () => {
  const original = blocoDeVersao('A identificação exige uma hipótese explícita.', 1);
  const ancora = ancoraDeSelecao(original, 22, 44);
  const marcaBase = marca({ ancora });

  test('reencontra a citação em versão com um parágrafo a mais', () => {
    const novos = [
      { id: '00000000000000000000000009', texto: 'Parágrafo novo antes de tudo.', versao_id: '00000000000000000000000021' },
      { id: original.id, texto: original.texto, versao_id: '00000000000000000000000021' },
    ];
    const resultado = reancorar(novos, marcaBase);
    expect(resultado.validade).toBe('resolvida');
    expect(resultado.ancora?.versao_id).toBe('00000000000000000000000021');
    expect(resultado.ancora?.citacao).toBe(ancora.citacao);
    expect(resultado.ancora?.bloco_id).toBe(original.id);
  });

  test('cai para a busca só pela citação quando o contexto mudou', () => {
    const novos = [{ id: original.id, texto: 'Agora a identificação exige uma hipótese explícita, disse ele.', versao_id: '00000000000000000000000021' }];
    const resultado = reancorar(novos, marcaBase);
    expect(resultado.validade).toBe('resolvida');
    expect(resultado.ancora?.inicio_utf16).toBe(novos[0]?.texto.indexOf(ancora.citacao));
  });

  test('citação duplicada em blocos diferentes fica ambígua com candidatos', () => {
    const novos = [
      { id: '00000000000000000000000031', texto: `Antes. ${ancora.citacao} Depois.`, versao_id: '00000000000000000000000021' },
      { id: '00000000000000000000000032', texto: `Outro. ${ancora.citacao} Fim.`, versao_id: '00000000000000000000000021' },
    ];
    const resultado = reancorar(novos, marcaBase);
    expect(resultado.validade).toBe('ambigua');
    expect(resultado.candidatos).toEqual(['00000000000000000000000031', '00000000000000000000000032']);
    expect(resultado.ancora).toBeUndefined();
  });

  test('citação apagada vira órfã e a marca recebida não muda', () => {
    const copia = structuredClone(marcaBase);
    const resultado = reancorar([{ id: original.id, texto: 'Texto reescrito por completo.', versao_id: '00000000000000000000000021' }], marcaBase);
    expect(resultado).toEqual({ validade: 'orfa' });
    expect(marcaBase).toEqual(copia);
  });
});

test('muitas ocorrências permanecem ambíguas sem construir pares quadráticos', () => {
  const b = blocoDeVersao('ab'.repeat(20000));
  expect(resolverCitacao(b, { citacao: 'ab' })).toMatchObject({ ok: false, motivo: 'ambigua', ocorrencias: 20000 });
});
test('subfaixas recusam âncora de outra versão ou de outro texto', () => {
  const b = blocoDeVersao('🧭 café exemplo');
  const a = ancoraDeSelecao(b, 3, b.texto.length);
  expect(() => resolverSubfaixas(b, { ...a, versao_id: 'outra' }, ['café'])).toThrow('versão');
  expect(() => resolverSubfaixas({ ...b, texto: 'outro conteúdo' }, a, ['café'])).toThrow();
  expect(resolverSubfaixas(b, a, ['café']).subfaixas).toEqual([{ inicio_utf16: 3, fim_utf16: 8 }]);
});
