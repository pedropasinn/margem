import { expect, test } from 'vitest';
import { conferirProveniencia, validarProveniencia, type ProvenienciaV1 } from './index';
import { canonicoDaFixture } from '../testes/fixture';
const c = canonicoDaFixture();
const p: ProvenienciaV1 = { versao: 1, sha256_original: c.documento.sha256_original, hash_estrutural: c.hash_estrutural,
  extrator: { nome: 'PyMuPDF', versao: '1' }, observacoes: [{ pagina: 1, ordem: 0, texto: ' ﬁ ', bbox: [0, 0, 10, 10],
    spans: [{ texto: ' ﬁ ', bbox: [0, 0, 10, 10], fonte: 'Times', tamanho: 12, flags: 0 }] }],
  transformacoes: [{ regra: 'ligaturas_tipograficas', antes: 'ﬁ', depois: 'fi', bloco_id: c.blocos[0]!.id }] };
test('observação conserva espaços e glifos, identidade resolve no canônico', () => {
  expect(validarProveniencia(p)).toBe(true);
  expect(conferirProveniencia(p, c)).toBe(true);
  expect(conferirProveniencia({ ...p, hash_estrutural: 'f'.repeat(64) }, c)).toBe(false);
  expect(conferirProveniencia({ ...p, transformacoes: [{ ...p.transformacoes[0]!, bloco_id: '0'.repeat(26) }] }, c)).toBe(false);
});
test('recusa alteração da observação, ordem, origem sem contexto e campos desconhecidos', () => {
  for (const mudar of [
    (d: ProvenienciaV1) => { d.observacoes[0]!.texto = 'fi'; },
    (d: ProvenienciaV1) => { d.observacoes[0]!.ordem = 1; },
    (d: ProvenienciaV1) => { delete d.transformacoes[0]!.bloco_id; },
    (d: ProvenienciaV1) => { d.observacoes[0]!.bbox = [10, 0, 0, 10]; },
  ]) { const d = structuredClone(p); mudar(d); expect(validarProveniencia(d)).toBe(false); }
  expect(validarProveniencia({ ...p, extra: true })).toBe(false);
});
