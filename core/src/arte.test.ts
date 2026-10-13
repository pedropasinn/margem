import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import { validarAnaliseCurtaDaObra, validarModeloDaObra } from '../../contratos/src/validadores';
import { cameraNoInstante, conferirAnaliseCurta, conferirModeloDaObra, contemRetangulo, enquadrarRegiao, iouDeRetangulos, limitesDaRegiao, QUADRO_INTEIRO } from './arte';
function ler<T>(nome: string): T { return JSON.parse(readFileSync(new URL(`../../fixtures/arte/${nome}.json`, import.meta.url), 'utf8')) as T; }
describe('modelo da obra e projeções', () => {
  for (const nome of ['educacao', 'tolo']) it(`${nome}: contrato, integridade, ritmo e câmera`, () => {
    const m = ler<ModeloDaObraV1>(`${nome}.modelo`), c = ler<AnaliseCurtaDaObraV1>(`${nome}.curta`);
    expect(validarModeloDaObra(m)).toBe(true); expect(validarAnaliseCurtaDaObra(c)).toBe(true);
    expect(conferirModeloDaObra(m)).toEqual([]); expect(conferirAnaliseCurta(c, m)).toEqual([]);
  });
  it('recusa campo desconhecido e coordenada estrutural inválida', () => {
    const m = ler<ModeloDaObraV1>('educacao.modelo');
    expect(validarModeloDaObra({ ...m, roteiro: {} })).toBe(false);
    m.regioes[0]!.forma = { tipo: 'ponto', x: -0.1, y: .4 };
    expect(validarModeloDaObra(m)).toBe(false);
  });
  it('não permite fonte inexistente, fato sem fonte ou intenção com certeza', () => {
    const m = ler<ModeloDaObraV1>('educacao.modelo');
    m.afirmacoes[0]!.fontes = []; m.afirmacoes[1]!.fontes = ['ausente'];
    m.afirmacoes.find(a => a.tipo === 'intencao_desconhecida')!.confianca = 'alta';
    expect(conferirModeloDaObra(m)).toEqual(expect.arrayContaining(['afirmacao_documentada_sem_fonte', 'referencia_ausente', 'intencao_com_certeza']));
  });
  it('recusa acervo como prova de sala e troca silenciosa de imagem', () => {
    const m = ler<ModeloDaObraV1>('educacao.modelo'); m.localizacao.sala = '12'; m.imagem.sha256 = 'b'.repeat(64);
    expect(conferirModeloDaObra(m)).toEqual(expect.arrayContaining(['sala_sem_exposicao_confirmada', 'ancora_de_outra_imagem']));
  });
  it('recusa apoios cíclicos e ids duplicados', () => {
    const m = ler<ModeloDaObraV1>('tolo.modelo'); m.afirmacoes[0]!.apoios = [m.afirmacoes[0]!.id];
    m.regioes.push(m.regioes[0]!);
    expect(conferirModeloDaObra(m)).toEqual(expect.arrayContaining(['apoios_ciclicos', 'ids_duplicados']));
  });
  it('valida polígono e ponto sem depender da viewport', () => {
    const m = ler<ModeloDaObraV1>('tolo.modelo');
    m.regioes[0]!.forma = { tipo: 'poligono', pontos: [{ x: .2, y: .2 }, { x: .5, y: .2 }, { x: .5, y: .6 }] };
    m.regioes[1]!.forma = { tipo: 'ponto', x: 1, y: 0 };
    expect(validarModeloDaObra(m)).toBe(true); expect(conferirModeloDaObra(m)).toEqual([]);
    expect(limitesDaRegiao(m.regioes[1]!.forma)).toEqual({ x: .92, y: 0, largura: .08, altura: .08 });
    m.regioes[0]!.forma = { tipo: 'poligono', pontos: [{ x: .2, y: .2 }, { x: .3, y: .3 }, { x: .4, y: .4 }] };
    expect(conferirModeloDaObra(m)).toContain('poligono_degenerado');
  });
  it('detecta projeção antiga, intervalo sobreposto, fala apressada e região fora de cena', () => {
    const m = ler<ModeloDaObraV1>('educacao.modelo'), c = ler<AnaliseCurtaDaObraV1>('educacao.curta');
    c.revisao_modelo++; c.batidas[1]!.inicio_s = 0; c.batidas[1]!.fim_s = .1;
    c.batidas[1]!.camera.para = { x: 0, y: 0, largura: .1, altura: .1 };
    expect(conferirAnaliseCurta(c, m)).toEqual(expect.arrayContaining(['projecao_desatualizada', 'timeline_descontinua', 'fala_apressada', 'regiao_fora_da_camera']));
  });
  it('interpola câmera geometricamente e usa o último enquadramento ao terminar', () => {
    const c = ler<AnaliseCurtaDaObraV1>('educacao.curta');
    c.batidas[0]!.camera = { de: QUADRO_INTEIRO, para: { x: .2, y: .2, largura: .6, altura: .6 } };
    expect(cameraNoInstante(c, c.batidas[0]!.fim_s / 2)).toEqual({ x: .1, y: .1, largura: .8, altura: .8 });
    expect(cameraNoInstante(c, 999)).toEqual(c.batidas.at(-1)!.camera.para);
  });
});

describe('regressão do benchmark real', () => {
  for (const nome of ['educacao', 'tolo']) it(`${nome}: saída gravada continua válida sem chamar modelo`, () => {
    const lerBenchmark = <T,>(tipo: string): T => JSON.parse(readFileSync(new URL(`../../docs/arte/benchmark/${nome}.${tipo}.json`, import.meta.url), 'utf8')) as T;
    const m = lerBenchmark<ModeloDaObraV1>('modelo'), c = lerBenchmark<AnaliseCurtaDaObraV1>('curta');
    expect(validarModeloDaObra(m)).toBe(true); expect(validarAnaliseCurtaDaObra(c)).toBe(true);
    expect(conferirModeloDaObra(m)).toEqual([]); expect(conferirAnaliseCurta(c, m)).toEqual([]);
    if (nome === 'educacao') expect(conferirAnaliseCurta(lerBenchmark('curta-bruta'), m)).toContain('fala_apressada');
  });
});

describe('enquadramento determinístico da câmera', () => {
  it('detalhe contém a região inteira, tem lado igual e não sai da obra', () => {
    const forma = { tipo: 'bbox' as const, x: 0.85, y: 0.05, largura: 0.12, altura: 0.2 };
    const c = enquadrarRegiao(forma, 'detalhe');
    expect(c.largura).toBeCloseTo(c.altura, 3);
    expect(c.x + c.largura).toBeLessThanOrEqual(1);
    expect(contemRetangulo(c, limitesDaRegiao(forma))).toBe(true);
  });
  it('meio abre mais que detalhe; inteiro e região enorme dão o quadro inteiro', () => {
    const forma = { tipo: 'bbox' as const, x: 0.4, y: 0.4, largura: 0.1, altura: 0.1 };
    expect(enquadrarRegiao(forma, 'meio').largura).toBeGreaterThan(enquadrarRegiao(forma, 'detalhe').largura);
    expect(enquadrarRegiao(forma, 'inteiro')).toEqual(QUADRO_INTEIRO);
    expect(enquadrarRegiao({ tipo: 'bbox', x: 0, y: 0, largura: 0.8, altura: 0.7 }, 'detalhe')).toEqual(QUADRO_INTEIRO);
    expect(enquadrarRegiao(null, 'detalhe')).toEqual(QUADRO_INTEIRO);
  });
  it('IoU de retângulos', () => {
    const a = { x: 0, y: 0, largura: 0.5, altura: 0.5 };
    expect(iouDeRetangulos(a, a)).toBe(1);
    expect(iouDeRetangulos(a, { x: 0.5, y: 0.5, largura: 0.2, altura: 0.2 })).toBe(0);
    expect(iouDeRetangulos(a, { x: 0.25, y: 0, largura: 0.5, altura: 0.5 })).toBeCloseTo(1 / 3, 5);
  });
});
