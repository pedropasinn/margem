import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { conferirGeometria, validarGeometria } from './index';
import { canonicoDaFixture } from '../testes/fixture';
import type { GeometriaV1 } from './tipos';

const pasta = new URL('../casos/Geometria/', import.meta.url);
for (const nome of readdirSync(pasta)) test(nome, () => {
  const valor: unknown = JSON.parse(readFileSync(new URL(nome, pasta), 'utf8'));
  expect(validarGeometria(valor)).toBe(nome.startsWith('valido-'));
});
test('referências, fronteiras, espaço nas pontas e origem na mesma página', () => {
  const c = canonicoDaFixture();
  const b = c.blocos[0]!;
  b.texto = '🧭 café fim';
  b.origens = [{ tipo: 'pdf', pagina: 1, bbox: [0, 0, 100, 100] }];
  const g = JSON.parse(readFileSync(new URL('valido-minimo.json', pasta), 'utf8')) as GeometriaV1;
  g.palavras[0] = { bloco_id: b.id, inicio_utf16: 0, fim_utf16: 2, pagina: 1, quad: [0, 0, 10, 0, 10, 10, 0, 10] };
  expect(conferirGeometria(g, c)).toBe(true);
  for (const mudanca of [{ bloco_id: 'ausente' }, { fim_utf16: 100 }, { inicio_utf16: 1 }, { fim_utf16: 3 }, { pagina: 2 }]) {
    const copia = structuredClone(g); Object.assign(copia.palavras[0]!, mudanca);
    expect(conferirGeometria(copia, c)).toBe(false);
  }
  b.origens = [{ tipo: 'texto', linha_inicio: 1, linha_fim: 1 }];
  expect(conferirGeometria(g, c)).toBe(false);
});
