import { describe, expect, it, vi } from 'vitest';
import { arquivosDosArgumentos } from '../src/principal/argumentos.js';
import { criarEncaminhador, linkDosArgumentos, registrarProtocolo, rotaDoLink } from '../src/principal/protocolo.js';

const DOC = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SEC = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const BLO = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

describe('R2-6: links margem://', () => {
  it('leva só às rotas de documento e de leitura', () => {
    expect(rotaDoLink(`margem://abrir/documentos/${DOC}`)).toBe(`/documentos/${DOC}`);
    expect(rotaDoLink(`margem://abrir/documentos/${DOC}/`)).toBe(`/documentos/${DOC}`);
    expect(rotaDoLink(`margem://abrir/ler/${DOC}`)).toBe(`/ler/${DOC}`);
    expect(rotaDoLink(`margem://abrir/ler/${DOC}/${SEC}?bloco=${BLO}`)).toBe(`/ler/${DOC}/${SEC}?bloco=${BLO}`);
    expect(rotaDoLink(`margem://abrir/ler/${DOC}/${SEC}`)).toBe(`/ler/${DOC}/${SEC}`);
    expect(rotaDoLink(`margem://abrir?documento=${DOC}`)).toBe(`/documentos/${DOC}`);
    expect(rotaDoLink(`margem://abrir?documento=${DOC}&secao=${SEC}&bloco=${BLO}`)).toBe(`/ler/${DOC}/${SEC}?bloco=${BLO}`);
    expect(rotaDoLink('margem://abrir/')).toBe('/');
    expect(rotaDoLink('MARGEM://ABRIR/')).toBe('/');
  });
  it('recusa o resto: outro esquema, outro destino, ids inválidos, credenciais', () => {
    expect(rotaDoLink(`http://127.0.0.1:8730/documentos/${DOC}`)).toBeNull();
    expect(rotaDoLink(`margem://outro/documentos/${DOC}`)).toBeNull();
    expect(rotaDoLink('margem://abrir/api/documentos')).toBeNull();
    expect(rotaDoLink('margem://abrir/documentos/../api/sessao')).toBeNull();
    expect(rotaDoLink('margem://abrir/documentos/nao-e-ulid')).toBeNull();
    expect(rotaDoLink(`margem://abrir/ler/${DOC}/${SEC}?bloco=<script>`)).toBeNull();
    expect(rotaDoLink(`margem://x@abrir/documentos/${DOC}`)).toBeNull();
    expect(rotaDoLink(`margem://abrir:99/documentos/${DOC}`)).toBeNull();
    expect(rotaDoLink('margem://abrir?documento=../x')).toBeNull();
    expect(rotaDoLink('não é link')).toBeNull();
  });
  it('acha o link na linha de comando (Windows e Linux) sem confundir com "Abrir com"', () => {
    const argv = ['--no-sandbox', `margem://abrir/documentos/${DOC}`];
    expect(linkDosArgumentos(argv)).toBe(`margem://abrir/documentos/${DOC}`);
    expect(linkDosArgumentos(['/home/ana/livro.pdf'])).toBeNull();
    expect(arquivosDosArgumentos(argv, '/home/ana', (pasta, caminho) => `${pasta}/${caminho}`)).toEqual([]);
  });
  it('guarda a rota até a biblioteca abrir e entrega uma vez', () => {
    let pronta = false;
    const abertas: string[] = [];
    const encaminhador = criarEncaminhador((rota) => { if (!pronta) return false; abertas.push(rota); return true; });
    expect(encaminhador.receber(null)).toBe(false);
    expect(encaminhador.receber('margem://abrir/api/x')).toBe(false);
    expect(encaminhador.receber(`margem://abrir/documentos/${DOC}`)).toBe(true);
    expect(abertas).toEqual([]);
    expect(encaminhador.pendente()).toBe(`/documentos/${DOC}`);
    expect(encaminhador.pendente()).toBeNull();
    pronta = true;
    encaminhador.receber(`margem://abrir/ler/${DOC}`);
    expect(abertas).toEqual([`/ler/${DOC}`]);
    expect(encaminhador.pendente()).toBeNull();
  });
  it('registra o esquema; em desenvolvimento, com o caminho do app', () => {
    const app = { setAsDefaultProtocolClient: vi.fn(() => true) };
    expect(registrarProtocolo(app, null)).toBe(true);
    expect(app.setAsDefaultProtocolClient).toHaveBeenLastCalledWith('margem');
    registrarProtocolo(app, { execPath: '/usr/bin/electron', app: '/repo/desktop' });
    expect(app.setAsDefaultProtocolClient).toHaveBeenLastCalledWith('margem', '/usr/bin/electron', ['/repo/desktop']);
    expect(registrarProtocolo({ setAsDefaultProtocolClient: () => { throw new Error('sem registro'); } }, null)).toBe(false);
  });
});
