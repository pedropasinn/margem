import { describe, expect, it } from 'vitest';
import { pastasDaBiblioteca, pastasDoApp } from '../src/nucleo/configuracao.js';
import type { RecursosResolvidos } from '../src/nucleo/recursos.js';
import { decidirConfinamento } from '../src/nucleo/confinamento.js';
import { ambienteDosFilhos, EXTENSAO_PADRAO } from '../src/nucleo/servico.js';

const RECURSOS: RecursosResolvidos = {
  postgres: null,
  codex: { caminho: '/r/bin/codex', origem: 'embutido' },
  motor: { caminho: '/r/motor/margem-motor', origem: 'embutido' },
  fonte: { caminho: '/r/fontes/DejaVuSans.ttf', origem: 'embutido' },
  ytDlp: { caminho: '/r/bin/yt-dlp', origem: 'embutido' },
  ffmpeg: { caminho: '/r/bin/ffmpeg', origem: 'embutido' },
  ffprobe: null,
  pastaBin: '/r/bin',
};

describe('ambiente da API e do worker (contrato com o J114)', () => {
  const entrada = {
    recursos: RECURSOS, pastasDoApp: pastasDoApp('/u'), biblioteca: pastasDaBiblioteca('/docs/Margem'),
    portaDaApi: 8730, urlDoBanco: 'postgres://margem:x@127.0.0.1:5999/margem', raiz: '/r/margem', sistema: 'linux' as const,
  };

  it('define as variáveis do contrato', () => {
    const ambiente = ambienteDosFilhos({ ...entrada, base: { PATH: '/usr/bin', HOME: '/h' } });
    expect(ambiente).toMatchObject({
      MARGEM_MODO: 'instalado', MARGEM_APP_DESKTOP: '1', MARGEM_ENDERECO: '127.0.0.1', MARGEM_PORTA: '8730',
      DATABASE_URL: entrada.urlDoBanco, MARGEM_DADOS: '/docs/Margem', CODEX_HOME: '/u/codex',
      MARGEM_CODEX_MOTOR: '/r/bin/codex', MARGEM_MOTOR: '/r/motor/margem-motor', MARGEM_YT_DLP: '/r/bin/yt-dlp',
      MARGEM_FFMPEG: '/r/bin/ffmpeg', MARGEM_FONTE: '/r/fontes/DejaVuSans.ttf', MARGEM_RAIZ: '/r/margem',
      MARGEM_MODELO: 'conta', MARGEM_SLOTS: '2', MARGEM_EXTENSOES: EXTENSAO_PADRAO, PATH: '/r/bin:/usr/bin', HOME: '/h',
    });
    expect('MARGEM_FFPROBE' in ambiente).toBe(false);
    expect('MARGEM_RECURSOS' in ambiente).toBe(false);
    expect('MARGEM_AVISOS' in ambiente).toBe(false);
    expect('MARGEM_ARTE_DIR' in ambiente).toBe(false);
  });

  it('acrescenta as variáveis do confinamento e os avisos', () => {
    const ambiente = ambienteDosFilhos({ ...entrada, base: { MARGEM_AVISOS: 'velho' }, extras: { MARGEM_CONFINAMENTO: 'nativo' }, avisos: ['um', 'dois'] });
    expect(ambiente.MARGEM_CONFINAMENTO).toBe('nativo');
    expect(ambiente.MARGEM_AVISOS).toBe('um\ndois');
  });

  it('a pessoa manda em modelo, slots, extensões e recursos; PG* e caminhos velhos saem', () => {
    const ambiente = ambienteDosFilhos({
      ...entrada,
      base: { Path: 'C:\\x', MARGEM_MODELO: 'gpt-x', MARGEM_SLOTS: '1', MARGEM_EXTENSOES: 'abc', MARGEM_RECURSOS: 'noticias', PGPASSWORD: 'p', MARGEM_FFPROBE: '/velho' },
      sistema: 'win32',
    });
    expect(ambiente).toMatchObject({ MARGEM_MODELO: 'gpt-x', MARGEM_SLOTS: '1', MARGEM_EXTENSOES: 'abc', MARGEM_RECURSOS: 'noticias', PATH: '/r/bin;C:\\x' });
    expect(ambiente.PGPASSWORD).toBeUndefined();
    expect(ambiente.Path).toBeUndefined();
    expect(ambiente.MARGEM_FFPROBE).toBeUndefined();
  });
});

describe('confinamento do Codex no Linux', () => {
  it('bwrap funcionando: o padrão do serviço (nada a acrescentar)', async () => {
    const d = await decidirConfinamento({ sistema: 'linux', ambiente: {}, testar: () => Promise.resolve({ ok: true, detalhe: '' }) });
    expect(d).toMatchObject({ variaveis: {}, aviso: null });
  });
  it('bwrap ausente ou bloqueado: nativo, com aviso', async () => {
    const testadas: string[] = [];
    const d = await decidirConfinamento({
      sistema: 'linux', ambiente: { MARGEM_BWRAP: '/opt/bwrap' },
      testar: (b) => { testadas.push(b); return Promise.resolve({ ok: false, detalhe: 'setting up uid map: Permission denied' }); },
    });
    expect(testadas).toEqual(['/opt/bwrap']);
    expect(d.variaveis).toEqual({ MARGEM_CONFINAMENTO: 'nativo' });
    expect(d.aviso).toMatch(/bubblewrap/);
  });
  it('escolha da pessoa e fora do Linux: nada é testado', async () => {
    const nunca = () => Promise.reject(new Error('não devia testar'));
    expect((await decidirConfinamento({ sistema: 'linux', ambiente: { MARGEM_CONFINAMENTO: 'bwrap' }, testar: nunca })).variaveis).toEqual({});
    expect((await decidirConfinamento({ sistema: 'darwin', ambiente: {}, testar: nunca })).aviso).toBeNull();
  });
});
