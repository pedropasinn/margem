import { afterEach, describe, expect, test, vi } from 'vitest';
import { APARENCIA_PADRAO, CORES_DE_CONTRASTE, guardarPreferencias, lerPreferencias, reduzirPreferencias } from './preferencias';
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe('aparência persistida', () => {
  test('muda campos independentes, restaura e mantém as cores do método por padrão', () => {
    const alterada = reduzirPreferencias(APARENCIA_PADRAO, { tipo: 'alterar', valores: { tema: 'sepia', tamanho: 21, cores: CORES_DE_CONTRASTE } });
    expect(alterada).toMatchObject({ tema: 'sepia', tamanho: 21, estilo: 'grifo', cores: CORES_DE_CONTRASTE });
    // Escolher o marca-texto fica: a troca para o grifo só vale para o que foi guardado antes da versão 3.
    expect(reduzirPreferencias(alterada, { tipo: 'alterar', valores: { estilo: 'marca_texto' } }).estilo).toBe('marca_texto');
    expect(reduzirPreferencias(alterada, { tipo: 'alterar', valores: { margem: 'mostrar' } }).margem).toBe('mostrar');
    expect(reduzirPreferencias(alterada, { tipo: 'restaurar' })).toEqual(APARENCIA_PADRAO);
  });
  test('versão 3: o marca-texto guardado antes vira grifo; o escolhido depois fica', () => {
    localStorage.setItem('margem:aparencia', JSON.stringify({ ...APARENCIA_PADRAO, estilo: 'marca_texto', versao: 2 }));
    expect(lerPreferencias().estilo).toBe('grifo');
    localStorage.setItem('margem:aparencia', JSON.stringify({ ...APARENCIA_PADRAO, estilo: 'sublinhado', versao: 2 }));
    expect(lerPreferencias().estilo).toBe('sublinhado');
    guardarPreferencias({ ...APARENCIA_PADRAO, estilo: 'marca_texto' });
    expect(lerPreferencias().estilo).toBe('marca_texto');
    localStorage.clear();
  });
  test('storage indisponível não impede ler nem mudar a aparência', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } });
    expect(lerPreferencias()).toEqual(APARENCIA_PADRAO);
    expect(() => guardarPreferencias(APARENCIA_PADRAO)).not.toThrow();
  });
  test('persiste e recusa JSON corrompido, valores fora da lista e cores inválidas', () => {
    guardarPreferencias({ ...APARENCIA_PADRAO, tema: 'escuro' });
    expect(lerPreferencias().tema).toBe('escuro');
    localStorage.setItem('margem:aparencia', '{');
    expect(lerPreferencias()).toEqual(APARENCIA_PADRAO);
    localStorage.setItem('margem:aparencia', JSON.stringify({ tamanho: 500, tema: 'inexistente', intensidade: 2, cores: { tese: 'url(https://invalido)' } }));
    expect(lerPreferencias()).toEqual({ ...APARENCIA_PADRAO, intensidade: 1 });
  });
  test('as notas abrem recolhidas nos números; quem guardou o padrão antigo também passa a abrir assim', () => {
    expect(APARENCIA_PADRAO.margem).toBe('recolher');
    localStorage.setItem('margem:aparencia', JSON.stringify({ ...APARENCIA_PADRAO, margem: 'mostrar' }));
    expect(lerPreferencias().margem).toBe('recolher');
    // Escolhido depois da mudança, vale a escolha.
    guardarPreferencias({ ...APARENCIA_PADRAO, margem: 'mostrar' });
    expect(lerPreferencias().margem).toBe('mostrar');
  });
});
