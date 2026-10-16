import { describe, expect, it } from 'vitest';
import { atalhoNoSistema, comComando, ehMac, teclaNoSistema, textoNoSistema } from './teclas';

describe('atalhos por sistema (J154)', () => {
  it('Mac pela ponte do app de computador ou pelo navigator', () => {
    expect(ehMac(undefined, { janela: { sistema: 'darwin' } })).toBe(true);
    expect(ehMac({ platform: 'MacIntel' }, { janela: { sistema: 'win32' } })).toBe(false);
    expect(ehMac({ platform: 'MacIntel' }, undefined)).toBe(true);
    expect(ehMac({ userAgentData: { platform: 'macOS' } }, undefined)).toBe(true);
    expect(ehMac({ platform: 'Win32' }, undefined)).toBe(false);
    expect(ehMac({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, undefined)).toBe(false);
    expect(ehMac({ platform: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }, undefined)).toBe(true);
  });

  it('Ctrl ou ⌘ valem como Comando', () => {
    expect(comComando({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(comComando({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(comComando({ ctrlKey: false, metaKey: false })).toBe(false);
  });

  it('rótulos: ⌘, ⇧ e ⌥ no Mac; iguais no Windows e no Linux', () => {
    expect(atalhoNoSistema('Ctrl K', true)).toBe('⌘ K');
    expect(atalhoNoSistema('Shift Ctrl S', true)).toBe('⇧ ⌘ S');
    expect(atalhoNoSistema('Ctrl+O', true)).toBe('⌘+O');
    expect(atalhoNoSistema('Ctrl +', true)).toBe('⌘ +');
    expect(atalhoNoSistema('Ctrl −', true)).toBe('⌘ −');
    expect(atalhoNoSistema('Shift Ctrl S', false)).toBe('Shift Ctrl S');
    expect(teclaNoSistema('Ctrl', true)).toBe('⌘');
    expect(teclaNoSistema('Alt', true)).toBe('⌥');
    expect(teclaNoSistema('K', true)).toBe('K');
    expect(teclaNoSistema('Ctrl', false)).toBe('Ctrl');
    expect(textoNoSistema('abra e use Ctrl F.', true)).toBe('abra e use ⌘ F.');
    expect(textoNoSistema('também Ctrl + roda do mouse', false)).toBe('também Ctrl + roda do mouse');
  });
});
