import { describe, expect, test } from 'vitest';
import { lerZip } from '../../testes/zip.js';
import { crc32, criarZip } from './zip.js';

describe('zip', () => {
  test('crc32 confere com o valor de referência', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  test('ida e volta com nomes UTF-8, determinístico, data DOS gravada', () => {
    const codificador = new TextEncoder();
    const arquivos = [
      { nome: 'Meditações - dúvida.md', conteudo: codificador.encode('# Olá\n\n> citação 🧭\n'), modificado_em: new Date(Date.UTC(2026, 8, 30, 21, 15, 42)) },
      { nome: 'vazio.md', conteudo: new Uint8Array(), modificado_em: new Date(Date.UTC(1970, 0, 1)) },
    ];
    const zip = criarZip(arquivos);
    expect(criarZip(arquivos)).toEqual(zip);
    const lidos = lerZip(zip);
    expect(lidos.map(({ nome, conteudo }) => ({ nome, conteudo }))).toEqual([
      { nome: 'Meditações - dúvida.md', conteudo: '# Olá\n\n> citação 🧭\n' },
      { nome: 'vazio.md', conteudo: '' },
    ]);
    expect(lidos[0]).toMatchObject({ dia: ((2026 - 1980) << 9) | (9 << 5) | 30, hora: (21 << 11) | (15 << 5) | 21 });
    // Antes de 1980 o DOS não representa: fica 01/01/1980.
    expect(lidos[1]).toMatchObject({ dia: (1 << 5) | 1, hora: 0 });
  });
});
