import { useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FORMULARIO_PADRAO_DA_SALA, type ValorDaRespostaDaSala } from '@margem/contratos/sala';
import { caminhoDaSala, rotaDaSala } from './AppDaSala';
import { CamposDoFormulario, progressoDoFormulario } from './CamposDoFormulario';
import { idDoEnunciado, perguntasProntas } from './EditorDoFormulario';
import { linkDaSala, mensagemDoConvite } from './api';
import { rotaDoCaminho, caminhoDaRota } from '../biblioteca/rotas';
afterEach(cleanup);

describe('rotas da sala', () => {
  test('o testador: capa, leitura e formulário sob /t/<slug>', () => {
    expect(rotaDaSala('/t/k7mq2xvt9pha')).toEqual({ slug: 'k7mq2xvt9pha', rota: { nome: 'capa' } });
    expect(rotaDaSala('/t/abc123/ler/DOC/SEC')).toEqual({ slug: 'abc123', rota: { nome: 'leitura', documento_id: 'DOC', secao_id: 'SEC' } });
    expect(rotaDaSala('/t/abc123/formulario')).toEqual({ slug: 'abc123', rota: { nome: 'formulario' } });
    expect(rotaDaSala('/biblioteca')).toBeNull();
    expect(caminhoDaSala('abc123', { nome: 'leitura', documento_id: 'D' })).toBe('/t/abc123/ler/D');
  });
  test('o leitor: /salas, /salas/nova, /salas/<id> e /salas/<id>/editar', () => {
    for (const caminho of ['/salas', '/salas/nova', '/salas/01KAAAAAAAAAAAAAAAAAAAAAAA', '/salas/01KAAAAAAAAAAAAAAAAAAAAAAA/editar']) {
      expect(caminhoDaRota(rotaDoCaminho(caminho))).toBe(caminho);
    }
  });
});

describe('formulário', () => {
  test('escala, escolha e textos com os tipos do contrato', () => {
    function Teste() {
      const [valores, definir] = useState<Record<string, ValorDaRespostaDaSala>>({});
      return <><CamposDoFormulario perguntas={FORMULARIO_PADRAO_DA_SALA.geral} valores={valores} faltando={new Set(['usaria_de_novo'])}
        aoMudar={(id, valor) => definir((atual) => { const novo = { ...atual }; if (valor === null) delete novo[id]; else novo[id] = valor; return novo; })} />
        <output>{JSON.stringify(valores)}</output></>;
    }
    render(<Teste />);
    fireEvent.click(screen.getAllByRole('radio', { name: '4' })[0]!);
    fireEvent.click(screen.getByRole('radio', { name: 'Talvez' }));
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'O ícone.' } });
    expect(JSON.parse(document.querySelector('output')?.textContent ?? '{}')).toEqual({ primeira_impressao: 4, usaria_de_novo: 'Talvez', o_que_confundiu: 'O ícone.' });
    // A pergunta que faltou no envio fica marcada.
    expect(screen.getByRole('group', { name: /usaria de novo/ }).getAttribute('data-falta')).toBe('true');
  });
  test('progresso conta gerais e por documento, ignorando texto vazio', () => {
    const perguntas = { geral: FORMULARIO_PADRAO_DA_SALA.geral, por_documento: [{ id: 'clareza', tipo: 'escala' as const, enunciado: 'x', obrigatoria: false }] };
    expect(progressoDoFormulario(perguntas, ['A', 'B'], null)).toEqual({ respondidas: 0, total: 8 });
    expect(progressoDoFormulario(perguntas, ['A', 'B'], { geral: { primeira_impressao: 3, o_que_faltou: '  ' }, por_documento: { B: { clareza: 2 } } })).toEqual({ respondidas: 2, total: 8 });
  });
  test('o editor gera ids únicos e limpa opções e rótulos soltos', () => {
    expect(idDoEnunciado('Qual foi a sua impressão?', new Set())).toBe('qual_foi_a_sua_impressao');
    expect(idDoEnunciado('Qual foi a sua impressão?', new Set(['qual_foi_a_sua_impressao']))).toBe('qual_foi_a_sua_impressao_2');
    expect(idDoEnunciado('123', new Set())).toBe('pergunta');
    expect(perguntasProntas([{ id: 'a', tipo: 'escolha', enunciado: ' A ', obrigatoria: true, opcoes: ['Sim', ' ', 'Sim', 'Não '] },
      { id: 'b', tipo: 'escala', enunciado: 'B', obrigatoria: false, rotulos: { minimo: 'x', maximo: '' } }]))
      .toEqual([{ id: 'a', tipo: 'escolha', enunciado: 'A', obrigatoria: true, opcoes: ['Sim', 'Não'] }, { id: 'b', tipo: 'escala', enunciado: 'B', obrigatoria: false }]);
  });
});

test('o convite tem o link e não leva a senha', () => {
  const link = linkDaSala({ url: 'https://maquina.exemplo.ts.net:8443', configurada: true }, 'k7mq2xvt9pha');
  expect(link).toBe('https://maquina.exemplo.ts.net:8443/t/k7mq2xvt9pha');
  const mensagem = mensagemDoConvite('Beta', link, null);
  expect(mensagem).toContain(link);
  expect(mensagem).toContain('senha que vou mandar em outra mensagem');
});
