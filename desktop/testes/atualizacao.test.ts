/**
 * Atualização automática silenciosa (V-W6, auditoria B-05). A mensagem é a que o electron-updater
 * deu no teste de 14/10, com a pilha e os cabeçalhos da resposta do GitHub.
 */
import { describe, expect, it } from 'vitest';
import {
  INTERVALO_DEPOIS_DE_FALHA_MS, INTERVALO_NORMAL_MS, classificarErroDeAtualizacao, criarControleDaAtualizacao, feedDoPacote, linhaDoRegistro,
  motivoCurto, proximoEstado, type EstadoDaAtualizacao,
} from '../src/nucleo/atualizacao.js';

const ERRO_DO_TESTE = [
  'HttpError: 404 ',
  '"method: GET url: https://github.com/pedropasinn/margem/releases.atom\\n\\nPlease double check that your authentication token is correct."',
  'Headers: {',
  '  "cache-control": "no-cache",',
  '  "set-cookie": ["_gh_sess=segredo; path=/; secure; HttpOnly"],',
  '}',
  '    at createHttpError (C:\\Users\\usuario\\AppData\\Local\\Programs\\margem\\resources\\app.asar\\node_modules\\builder-util-runtime\\out\\httpExecutor.js:20:12)',
].join('\n');

describe('atualização automática', () => {
  it('feed: sem o campo é o GitHub de antes; "desligada" e URL https', () => {
    expect(feedDoPacote({ version: '0.1.0' })).toEqual({ tipo: 'github' });
    expect(feedDoPacote({ margem: { atualizacao: 'desligada' } })).toEqual({ tipo: 'desligada' });
    expect(feedDoPacote({ margem: { atualizacao: 'https://margem.dev/atualizacoes/' } })).toEqual({ tipo: 'generic', url: 'https://margem.dev/atualizacoes/' });
    expect(feedDoPacote({ margem: { atualizacao: 'http://inseguro/' } })).toEqual({ tipo: 'desligada' });
    expect(feedDoPacote({ margem: { atualizacao: 'github' } })).toEqual({ tipo: 'github' });
    expect(feedDoPacote(null)).toEqual({ tipo: 'github' });
  });

  it('classifica: sem versão publicada, sem rede, outro', () => {
    expect(classificarErroDeAtualizacao(ERRO_DO_TESTE)).toBe('sem_versao');
    expect(classificarErroDeAtualizacao('No published versions on GitHub')).toBe('sem_versao');
    expect(classificarErroDeAtualizacao('Cannot find latest.yml in the latest release artifacts')).toBe('sem_versao');
    expect(classificarErroDeAtualizacao('getaddrinfo ENOTFOUND github.com')).toBe('sem_rede');
    expect(classificarErroDeAtualizacao('net::ERR_INTERNET_DISCONNECTED')).toBe('sem_rede');
    expect(classificarErroDeAtualizacao('sha512 checksum mismatch')).toBe('outro');
  });

  it('o registro leva só a primeira linha, sem pilha, cabeçalho nem cookie', () => {
    expect(linhaDoRegistro(ERRO_DO_TESTE)).toBe('HttpError: 404');
    expect(linhaDoRegistro(new Error('falhou\n    at x (y.js:1:1)'))).toBe('falhou');
    expect(linhaDoRegistro('set-cookie: a=b')).toBe('set-cookie: [redigido]');
    expect(linhaDoRegistro('GET https://x/latest.yml?token=abc&v=1')).toBe('GET https://x/latest.yml?token=[redigido]&v=1');
    expect(linhaDoRegistro('x'.repeat(500))).toHaveLength(200);
  });

  it('sem versão: um evento info por execução, nenhum aviso automático, espera de 24 h', () => {
    const controle = criarControleDaAtualizacao();
    const primeira = controle.aoFalhar(ERRO_DO_TESTE, false);
    expect(primeira).toEqual({ evento: { nome: 'atualizacao_indisponivel', dados: { motivo: 'sem_versao' } }, aviso: null, proximaMs: INTERVALO_DEPOIS_DE_FALHA_MS });
    expect(JSON.stringify(primeira)).not.toContain('segredo');
    // A segunda procura da mesma execução não registra de novo.
    expect(controle.aoFalhar(ERRO_DO_TESTE, false).evento).toBeNull();
    // Pedida pela pessoa: a caixa diz o motivo em vez de "Não foi possível procurar".
    expect(controle.aoFalhar(ERRO_DO_TESTE, true).aviso).toBe('Ainda não há versões publicadas do Margem para atualizar.');
    expect(controle.aoFalhar('getaddrinfo ENOTFOUND github.com', true)).toMatchObject({
      evento: { nome: 'atualizacao_indisponivel', dados: { motivo: 'sem_rede' } }, aviso: expect.stringMatching(/^Sem conexão/) as unknown,
    });
    expect(controle.aoFalhar('sha512 checksum mismatch\n  at z', false).evento).toEqual({ nome: 'atualizacao_falhou', dados: { mensagem: 'sha512 checksum mismatch' } });
    expect(controle.aoTerminarBem()).toBe(INTERVALO_NORMAL_MS);
    expect(INTERVALO_DEPOIS_DE_FALHA_MS).toBeGreaterThan(INTERVALO_NORMAL_MS);
  });

  it('estado mostrado no app (J146): procurar, baixar, pronta, falha', () => {
    const agora = new Date('2026-10-14T15:00:00Z');
    let estado: EstadoDaAtualizacao = { estado: 'ociosa' };
    estado = proximoEstado(estado, { tipo: 'procurar' });
    expect(estado).toEqual({ estado: 'procurando' });
    expect(proximoEstado(estado, { tipo: 'sem_novidade' }, agora)).toEqual({ estado: 'atualizada', quando: agora.toISOString() });
    estado = proximoEstado(estado, { tipo: 'disponivel', versao: '0.2.0', baixa: true });
    expect(estado).toEqual({ estado: 'baixando', versao: '0.2.0', porcentagem: 0 });
    estado = proximoEstado(estado, { tipo: 'progresso', porcentagem: 41.7 });
    expect(estado).toEqual({ estado: 'baixando', versao: '0.2.0', porcentagem: 41 });
    // Uma procura no meio do download não zera a barra.
    expect(proximoEstado(estado, { tipo: 'procurar' })).toBe(estado);
    expect(proximoEstado(estado, { tipo: 'progresso', porcentagem: 250 })).toMatchObject({ porcentagem: 100 });
    estado = proximoEstado(estado, { tipo: 'baixada', versao: '0.2.0' });
    expect(estado).toEqual({ estado: 'pronta', versao: '0.2.0' });
    // Pronta só sai para outra versão pronta: a procura de 6 em 6 h não apaga o "Reiniciar e atualizar".
    for (const evento of [{ tipo: 'procurar' }, { tipo: 'sem_novidade' }, { tipo: 'falhou', mensagem: 'ENOTFOUND' }] as const) {
      expect(proximoEstado(estado, evento)).toBe(estado);
    }
    expect(proximoEstado(estado, { tipo: 'baixada', versao: '0.3.0' })).toEqual({ estado: 'pronta', versao: '0.3.0' });
    // macOS sem assinatura: só avisa que há versão nova.
    expect(proximoEstado({ estado: 'procurando' }, { tipo: 'disponivel', versao: '0.2.0', baixa: false })).toEqual({ estado: 'manual', versao: '0.2.0' });
    expect(proximoEstado({ estado: 'procurando' }, { tipo: 'falhou', mensagem: ERRO_DO_TESTE })).toEqual({ estado: 'indisponivel', motivo: 'Ainda não há versões publicadas.' });
    const desligada: EstadoDaAtualizacao = { estado: 'desligada', motivo: 'sem_feed' };
    expect(proximoEstado(desligada, { tipo: 'procurar' })).toBe(desligada);
    expect(motivoCurto('getaddrinfo EAI_AGAIN margem.dev')).toBe('Sem conexão com a internet.');
    expect(motivoCurto('sha512 checksum mismatch')).toBe('Não foi possível procurar agora.');
    expect(JSON.stringify(proximoEstado({ estado: 'ociosa' }, { tipo: 'falhou', mensagem: ERRO_DO_TESTE }))).not.toContain('segredo');
  });
});
