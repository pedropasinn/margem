import { describe, expect, it } from 'vitest';
import { LINK_DOS_RELATOS, linkDoRelato, resumoDoApp, situacaoDoComponente, type DadosDoRelato } from '../src/principal/relato.js';

const DADOS: DadosDoRelato = {
  versao: '0.2.0', sistema: 'win32', versaoDoSistema: '10.0.22631', arquitetura: 'x64', electron: '44.7.0', empacotado: true,
  componentes: { banco: 'embutido', codex: 'embutido', motor: 'embutido', ffmpeg: 'ausente', 'yt-dlp': 'do sistema' },
  servico: 'no ar', chatgpt: 'não conectado', bibliotecaSincronizada: true,
};

describe('relatar um problema (U-12)', () => {
  it('o resumo diz versão, sistema, arquitetura e componentes, uma coisa por linha', () => {
    expect(resumoDoApp(DADOS)).toBe([
      'Margem 0.2.0', 'Sistema: Windows 10.0.22631 (x64)', 'Electron: 44.7.0', 'Serviço: no ar', 'ChatGPT: não conectado',
      'Biblioteca: em pasta sincronizada', 'Componentes: banco embutido, codex embutido, motor embutido, ffmpeg ausente, yt-dlp do sistema',
    ].join('\n'));
  });

  it('nada pessoal passa, mesmo se vier num campo: caminhos e textos livres viram "?"', () => {
    const resumo = resumoDoApp({ ...DADOS, versaoDoSistema: 'C:\\Users\\Maria\\Documentos', arquitetura: '/home/maria/livros', componentes: { 'C:\\Users\\Maria': 'embutido' } });
    expect(resumo).not.toMatch(/Maria|maria|Users|home/);
    expect(resumo).toContain('Sistema: Windows ? (?)');
  });

  it('o link abre o formulário de relato no GitHub com título e corpo pré-preenchidos', () => {
    const url = new URL(linkDoRelato(DADOS));
    expect(`${url.origin}${url.pathname}`).toBe(LINK_DOS_RELATOS);
    expect(url.searchParams.get('title')).toBe('Problema no Margem 0.2.0: ');
    const corpo = url.searchParams.get('body') ?? '';
    expect(corpo).toContain('## O que aconteceu');
    expect(corpo).toContain(resumoDoApp(DADOS));
    expect(corpo).toMatch(/Não cole aqui trechos de livros/);
  });

  it('a origem de cada componente, sem o caminho', () => {
    expect(situacaoDoComponente(null)).toBe('ausente');
    expect(situacaoDoComponente({ origem: 'embutido' })).toBe('embutido');
    expect(situacaoDoComponente({ origem: 'sistema' })).toBe('do sistema');
  });
});
