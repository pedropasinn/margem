import { describe, expect, test } from 'vitest';
import { lerModosDeLeitura } from './modos';
import { idsDosTipos, lerTiposDeTexto, tipoDeTexto, validarTipoDoDocumento, validarTiposDeTexto } from './tipos-de-texto';

describe('tipos de texto', () => {
  const tipos = lerTiposDeTexto();
  const modos = lerModosDeLeitura();

  test('a taxonomia é simples e abrangente: uns doze grupos, uns trinta tipos, cada um com um modo do catálogo', () => {
    expect(tipos.grupos.length).toBeGreaterThanOrEqual(12);
    expect(tipos.grupos.length).toBeLessThanOrEqual(14);
    const ids = idsDosTipos(tipos);
    expect(ids.length).toBeGreaterThanOrEqual(28);
    expect(ids.length).toBeLessThanOrEqual(36);
    expect(new Set(ids).size).toBe(ids.length);
    for (const grupo of tipos.grupos) for (const tipo of grupo.tipos) {
      expect(modos.some((modo) => modo.id === tipo.modo.id && modo.revisao === tipo.modo.revisao), tipo.id).toBe(true);
    }
    expect(tipoDeTexto(tipos, tipos.padrao)?.tipo.id).toBe('outro');
    // Os grupos de leitura previstos têm lugar próprio (levantamento de 29/09).
    for (const id of ['conto', 'romance', 'poesia', 'tratado_filosofico', 'escritura', 'magisterio', 'espiritualidade', 'economia_empirica',
      'matematica', 'estatistica', 'computacao', 'artigo_cientifico', 'historiografia', 'noticia', 'opiniao', 'email', 'didatico', 'lei']) {
      expect(tipoDeTexto(tipos, id), id).toBeDefined();
    }
    expect(tipoDeTexto(tipos, 'conto')?.grupo.rotulo).toBe('Literatura');
  });

  test('recusa campo desconhecido, id repetido, modo fora do catálogo e padrão inexistente', () => {
    const copia = () => structuredClone(tipos) as unknown as { padrao: string; grupos: { tipos: Record<string, unknown>[] }[] } & Record<string, unknown>;
    expect(validarTiposDeTexto(copia(), modos)).toBe(true);
    const extra = copia(); extra.extra = 1;
    expect(validarTiposDeTexto(extra, modos)).toBe(false);
    const repetido = copia(); repetido.grupos[1]!.tipos.push({ ...repetido.grupos[0]!.tipos[0]! });
    expect(validarTiposDeTexto(repetido, modos)).toBe(false);
    const semModo = copia(); semModo.grupos[0]!.tipos[0]!.modo = { id: 'inexistente', revisao: 1 };
    expect(validarTiposDeTexto(semModo, modos)).toBe(false);
    const semPadrao = copia(); semPadrao.padrao = 'nenhum';
    expect(validarTiposDeTexto(semPadrao, modos)).toBe(false);
    const estado = copia(); estado.grupos[0]!.tipos[0]!.estado = 'pronto';
    expect(validarTiposDeTexto(estado, modos)).toBe(false);
  });

  test('o tipo do documento: detectado ou escolhido, com tipos do catálogo', () => {
    const base = { tipo_id: 'conto', origem: 'detectado', confianca: 'media', justificativa: 'Narrativa curta.', alternativas: ['romance'], job_id: null, em: '2026-10-14T12:00:00.000Z' };
    expect(validarTipoDoDocumento(base, tipos)).toBe(true);
    expect(validarTipoDoDocumento({ ...base, origem: 'escolhido', confianca: null, justificativa: null, alternativas: [] }, tipos)).toBe(true);
    expect(validarTipoDoDocumento({ ...base, origem: 'adivinhado' }, tipos)).toBe(false);
    expect(validarTipoDoDocumento({ ...base, tipo_id: 'nenhum' }, tipos)).toBe(false);
    expect(validarTipoDoDocumento({ ...base, alternativas: ['nenhum'] }, tipos)).toBe(false);
    expect(validarTipoDoDocumento({ ...base, extra: true }, tipos)).toBe(false);
  });
});
