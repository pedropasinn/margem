import { expect, test } from 'vitest';
import { idDaInstancia, identidadeDaSaude } from './instancia.js';

test('a identificação é estável por pasta de dados e muda com a pasta (V-W9)', () => {
  const a = idDaInstancia({}, () => '/dados/biblioteca-a');
  expect(a).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
  expect(idDaInstancia({}, () => '/dados/biblioteca-a')).toBe(a);
  expect(idDaInstancia({}, () => '/dados/biblioteca-b')).not.toBe(a);
});

test('MARGEM_INSTANCIA fixa a identificação; valor fora do formato é ignorado', () => {
  expect(idDaInstancia({ MARGEM_INSTANCIA: 'Docker-Casa' }, () => '/x')).toBe('docker-casa');
  expect(idDaInstancia({ MARGEM_INSTANCIA: 'a b' }, () => '/x')).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
});

test('a saúde diz que é o Margem e se é o app de computador', () => {
  expect(identidadeDaSaude({ MARGEM_APP_DESKTOP: '1', MARGEM_INSTANCIA: 'abcd-1234' })).toEqual({ servico: 'margem', instancia_id: 'abcd-1234', app_de_computador: true });
  expect(identidadeDaSaude({ MARGEM_INSTANCIA: 'abcd-1234' }).app_de_computador).toBe(false);
});
