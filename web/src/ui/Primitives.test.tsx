import { useRef, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button, IconButton, Input, Textarea, Switch, Checkbox, Select, SegmentedControl, Popover, Drawer } from './Primitives';
afterEach(cleanup);
describe('primitives acessíveis', () => {
  test('Button e IconButton têm nome, foco e tipo que não envia formulário sem intenção', () => {
    const clicar = vi.fn();
    render(<><Button onClick={clicar}>Salvar</Button><IconButton aria-label="Fechar">×</IconButton></>);
    const salvar = screen.getByRole('button', { name: 'Salvar' }); salvar.focus();
    expect(document.activeElement).toBe(salvar); expect(salvar.getAttribute('type')).toBe('button');
    fireEvent.click(salvar); expect(clicar).toHaveBeenCalledOnce();
    screen.getByRole('button', { name: 'Fechar' }).focus();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Fechar');
  });
  test('Input e Textarea recebem nome pelo label e preservam digitação', () => {
    render(<><label>Título<Input /></label><label>Nota<Textarea /></label></>);
    for (const nome of ['Título', 'Nota']) {
      const campo = screen.getByRole('textbox', { name: nome }); campo.focus();
      fireEvent.change(campo, { target: { value: 'ação 🧭' } });
      expect(campo).toHaveProperty('value', 'ação 🧭'); expect(document.activeElement).toBe(campo);
    }
  });
  test('Switch e Checkbox expõem estado, usam botão nativo operável e guardam valor de formulário', () => {
    function Exemplo() { const [ativo, mudar] = useState(false); return <form><Switch checked={ativo} onChange={mudar}>Primeiro eu</Switch><Checkbox checked={ativo} onChange={mudar} name="tipo" value="imagem">Imagem</Checkbox></form>; }
    const { container } = render(<Exemplo />);
    const interruptor = screen.getByRole('switch', { name: 'Primeiro eu' }); interruptor.focus();
    expect(interruptor.tagName).toBe('BUTTON'); expect(document.activeElement).toBe(interruptor);
    fireEvent.click(interruptor); expect(interruptor.getAttribute('aria-checked')).toBe('true');
    const caixa = screen.getByRole('checkbox', { name: 'Imagem' }); caixa.focus();
    expect(caixa.getAttribute('aria-checked')).toBe('true');
    expect(new FormData(container.querySelector('form')!).get('tipo')).toBe('imagem');
    fireEvent.click(caixa); expect(interruptor.getAttribute('aria-checked')).toBe('false');
  });
  test('Select: setas, Home, End, Enter, pesquisa por letra e Esc sem mudar valor', () => {
    const mudar = vi.fn();
    render(<Select aria-label="Tema" defaultValue="claro" onChange={mudar}><option value="claro">Claro</option><option value="escuro">Escuro</option><option value="sepia">Sépia</option></Select>);
    const combo = screen.getByRole('combobox', { name: 'Tema' }); combo.focus();
    fireEvent.keyDown(combo, { key: 'End' }); expect(screen.getByRole('listbox', { name: 'Tema' })).toBeDefined();
    fireEvent.keyDown(combo, { key: 'Enter' }); expect(mudar).toHaveBeenLastCalledWith({ target: { value: 'sepia' } });
    fireEvent.keyDown(combo, { key: 'Home' }); fireEvent.keyDown(combo, { key: 'ArrowDown' }); fireEvent.keyDown(combo, { key: 'Enter' });
    expect(mudar).toHaveBeenLastCalledWith({ target: { value: 'escuro' } });
    fireEvent.keyDown(combo, { key: 'c' }); fireEvent.keyDown(combo, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull(); expect(mudar).toHaveBeenCalledTimes(2);
  });
  test('SegmentedControl tem grupo nomeado, seleção exclusiva e setas com foco', () => {
    function Exemplo() { const [valor, mudar] = useState('todas'); return <SegmentedControl rotulo="Visibilidade" valor={valor} aoMudar={mudar} opcoes={[{ valor: 'todas', rotulo: 'Todas' }, { valor: 'ocultas', rotulo: 'Ocultas' }]} />; }
    render(<Exemplo />); expect(screen.getByRole('radiogroup', { name: 'Visibilidade' })).toBeDefined();
    const todas = screen.getByRole('radio', { name: 'Todas' }); todas.focus(); fireEvent.keyDown(todas, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Ocultas' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Ocultas' }));
  });
  test.each(['popover', 'drawer'])('%s prende foco, fecha por Esc e devolve ao acionador', (tipo) => {
    function Exemplo() {
      const [aberto, abrir] = useState(false); const ancora = useRef<HTMLButtonElement>(null);
      const filhos = <><Button>Primeiro</Button><Button>Último</Button></>;
      return <><Button ref={ancora} onClick={() => abrir(true)}>Abrir</Button>{aberto && (tipo === 'popover' ? <Popover ancora={ancora} aoFechar={() => abrir(false)} rotulo="Opções">{filhos}</Popover> : <Drawer aoFechar={() => abrir(false)} rotulo="Opções">{filhos}</Drawer>)}</>;
    }
    render(<Exemplo />); const abrir = screen.getByRole('button', { name: 'Abrir' }); abrir.focus(); fireEvent.click(abrir);
    const painel = screen.getByRole('dialog', { name: 'Opções' });
    const ultimo = screen.getByRole('button', { name: 'Último' }); ultimo.focus(); fireEvent.keyDown(ultimo, { key: 'Tab' });
    expect(painel.contains(document.activeElement)).toBe(true); expect(document.activeElement).not.toBe(ultimo);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(abrir);
    fireEvent.click(abrir); fireEvent.pointerDown(document.body); expect(screen.queryByRole('dialog')).toBeNull();
  });
});

test('Select no Popover usa portal sem fechar o painel ao escolher; Escape fecha um nível por vez', () => {
  function Exemplo() {
    const ancora = useRef<HTMLButtonElement>(null);
    const [aberto, abrir] = useState(false);
    return <><Button ref={ancora} onClick={() => abrir(true)}>Opções</Button>{aberto && <Popover ancora={ancora} aoFechar={() => abrir(false)} rotulo="Painel"><Select aria-label="Tema"><option value="claro">Claro</option><option value="escuro">Escuro</option></Select></Popover>}</>;
  }
  render(<Exemplo />);
  fireEvent.click(screen.getByRole('button', { name: 'Opções' }));
  const combo = screen.getByRole('combobox', { name: 'Tema' });
  fireEvent.click(combo);
  const lista = screen.getByRole('listbox');
  expect(lista.parentElement).toBe(document.body);
  fireEvent.pointerDown(screen.getByRole('option', { name: 'Escuro' }));
  expect(screen.getByRole('dialog')).toBeDefined();
  fireEvent.click(screen.getByRole('option', { name: 'Escuro' }));
  expect(combo.textContent).toBe('Escuro');
  expect(screen.getByRole('dialog')).toBeDefined();
  fireEvent.click(combo); fireEvent.keyDown(combo, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.getByRole('dialog')).toBeDefined();
  fireEvent.keyDown(combo, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Opções' }));
});
