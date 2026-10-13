import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { canonicoDaFixture } from '../testes/fixture';
import { faixasDosVersos, hashEstrutural, projetarRawText, validarCanonico } from './index';

const pasta = new URL('../casos/Canonico/', import.meta.url);
test('mantém casos Unicode e esperados gerados pelo TypeScript para Python', () => {
  const unicode = canonicoDaFixture();
  const escapes = structuredClone(unicode);
  escapes.blocos = [
    { ...unicode.blocos[0]!, texto: 'Aspas " \\ \t \u0000\n\r\n\u2028\u2029 🧭 café ﬁ' },
    { ...unicode.blocos[1]!, texto: '' },
  ];
  escapes.hash_estrutural = hashEstrutural(escapes.blocos);
  // V1.1: estrofe com acento combinante e precomposto, travessão, emoji e verso longo; parágrafo para o separador.
  const estrofe = structuredClone(unicode);
  estrofe.blocos = [
    { ...unicode.blocos[0]!, tipo: 'estrofe', texto: 'Ó mar, que à tarde se desfaz em ouro,\n— dizia o velho, olhando o horizonte —\n' +
      'não guardes mais o que levaste um dia, porque a memória é longa e a noite, mais longa ainda, se estende sobre as casas adormecidas da cidade antiga,\n' +
      'e o cafe\u0301 esfria na mesa 🧭.' },
    { ...unicode.blocos[1]!, tipo: 'estrofe', texto: 'Verso único — só.' },
    { ...unicode.blocos[2]!, tipo: 'paragrafo', texto: 'Prosa depois do poema.' },
  ];
  estrofe.documento.titulo = 'Fixture estrofe';
  estrofe.hash_estrutural = hashEstrutural(estrofe.blocos);
  const gerados = { 'valido-unicode.json': unicode, 'valido-escapes.json': escapes, 'valido-estrofe.json': estrofe };
  for (const [arquivo, canonico] of Object.entries(gerados)) {
    if (process.env.GERAR_ESPERADOS === '1') writeFileSync(new URL(arquivo, pasta), JSON.stringify(canonico, null, 2) + '\n');
    expect(JSON.parse(readFileSync(new URL(arquivo, pasta), 'utf8'))).toEqual(canonico);
  }
  const esperados = readdirSync(pasta).filter((nome) => nome.startsWith('valido-')).sort().map((arquivo) => {
    const valor: unknown = JSON.parse(readFileSync(new URL(arquivo, pasta), 'utf8'));
    if (!validarCanonico(valor)) throw new Error(`Fixture inválida: ${arquivo}`);
    return {
      arquivo: `Canonico/${arquivo}`, hash_estrutural: hashEstrutural(valor.blocos),
      ...projetarRawText(valor.blocos),
      comprimentos_utf16: valor.blocos.map((bloco) => ({ id: bloco.id, comprimento: bloco.texto.length })),
      versos_utf16: valor.blocos.filter((bloco) => bloco.tipo === 'estrofe').map((bloco) => ({ id: bloco.id, faixas: faixasDosVersos(bloco.texto) })),
    };
  });
  const destino = new URL('../casos/esperados.json', import.meta.url);
  if (process.env.GERAR_ESPERADOS === '1') writeFileSync(destino, JSON.stringify(esperados, null, 2) + '\n');
  expect(JSON.parse(readFileSync(destino, 'utf8'))).toEqual(esperados);
});
