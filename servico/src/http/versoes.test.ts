import { expect, test } from 'vitest';
import { ancoraDeSelecao } from '@margem/core';
import { canonicoDeTeste, comBanco, idTeste } from '../../testes/apoio';
import { comTransacao } from '../db/transacao';
import * as documentos from '../repos/documentos';
import * as anotacoes from '../repos/anotacoes';
import { criarApi } from './app';
test('compara versões com paginação, preserva notas e recusa documentos distintos', async () => comBanco('versoes_j65', async banco => {
  const c = canonicoDeTeste({ blocos: Array.from({ length: 55 }, (_, i) => ({ tipo: 'paragrafo', texto: `Passagem ${i}.` })) });
  const d = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Passagem 0.' }, { tipo: 'paragrafo', texto: 'Novo trecho.' }] });
  const [a, b, outro] = await comTransacao(banco, async tx => {
    const doc = await documentos.criar(tx, { ...c.documento, origem_caminho: 'teste.txt' });
    const a = await documentos.criarVersao(tx, doc.id, c), b = await documentos.criarVersao(tx, doc.id, d);
    const fora = await documentos.criar(tx, { ...c.documento, origem_caminho: 'outro.txt' });
    const outro = await documentos.criarVersao(tx, fora.id, d);
    await anotacoes.criar(tx, { versao: 1, revisao_edicao: 1, id: idTeste('A', 1), tipo: 'nota', texto: 'Minha nota', versao_id: a.id,
      ancora: ancoraDeSelecao({ ...c.blocos[0]!, versao_id: a.id }, 0, c.blocos[0]!.texto.length),
      criada_em: '2026-09-28T00:00:00.000Z', atualizada_em: '2026-09-28T00:00:00.000Z' });
    return [a, b, outro] as const;
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
  const url = `/api/versoes/${a.id}/comparar/${b.id}`;
  const r = await api.request(url);
  expect(r.status).toBe(200);
  const pagina = await r.json() as { totais: { iguais: number; sem_par_antes: number }; antes: unknown[]; ha_proxima: boolean; anotacoes: { proposta: { tipo: string } }[] };
  expect(pagina.totais).toMatchObject({ iguais: 1, sem_par_antes: 54 });
  expect(pagina.antes).toHaveLength(50); expect(pagina.ha_proxima).toBe(true);
  expect(pagina.anotacoes[0]!.proposta.tipo).toBe('proposta');
  expect(await (await api.request(url + '?pagina=1')).json()).toMatchObject({ ha_proxima: false, totais: { sem_par_antes: 54 } });
  expect((await api.request(url + '?pagina=-1')).status).toBe(400);
  expect((await api.request(`/api/versoes/${a.id}/comparar/${outro.id}`)).status).toBe(422);
  expect((await api.request(`/api/versoes/${a.id}/comparar/${idTeste('V', 999)}`)).status).toBe(404);
  expect((await banco.query('SELECT versao_id,texto FROM anotacao')).rows).toEqual([{ versao_id: a.id, texto: 'Minha nota' }]);
}));
