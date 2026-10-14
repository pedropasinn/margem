import { useRef, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button, Chip, IconButton, Input, Textarea, Switch, Checkbox, Select, SegmentedControl, Popover, Drawer, classesDoBotao, posicaoDoPopover } from './Primitives';
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

test('Popover num portal do body: nenhum painel com camada própria ou rolagem o corta (V-T1)', () => {
  function Exemplo() {
    const ancora = useRef<HTMLButtonElement>(null);
    const [aberto, abrir] = useState(false);
    return <div className="barra-com-camada" style={{ position: 'sticky', zIndex: 60, overflow: 'hidden' }}><Button ref={ancora} onClick={() => abrir(true)}>Mais</Button>
      {aberto && <Popover ancora={ancora} aoFechar={() => abrir(false)} rotulo="Mais opções"><Button>Notas do livro</Button></Popover>}</div>;
  }
  render(<Exemplo />);
  fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
  const menu = screen.getByRole('dialog', { name: 'Mais opções' });
  expect(menu.parentElement).toBe(document.body);
  expect(menu.closest('.barra-com-camada')).toBeNull();
  expect(menu.style.position).toBe('fixed');
  // Os eventos continuam no React do dono: clicar dentro não fecha; fora, fecha.
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Notas do livro' }));
  expect(screen.getByRole('dialog', { name: 'Mais opções' })).toBeDefined();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('posição do popover: abaixo e à esquerda da âncora; perto da borda direita, alinha pela direita; sem altura embaixo, sobe', () => {
  const janela = { largura: 1280, altura: 800 };
  const caixa = (left: number, top: number, largura = 40, altura = 40) => ({ left, right: left + largura, top, bottom: top + altura });
  expect(posicaoDoPopover(caixa(100, 10), { largura: 260, altura: 300 }, janela)).toEqual({ left: 100, top: 58 });
  // O "…" da barra do leitor encostado no vídeo: o menu não passa da janela e fecha pela direita do botão.
  expect(posicaoDoPopover(caixa(1200, 10), { largura: 260, altura: 300 }, janela)).toEqual({ left: 980, top: 58 });
  // Botão na base (o player): abre para cima.
  expect(posicaoDoPopover(caixa(600, 720), { largura: 260, altura: 300 }, janela)).toEqual({ left: 600, top: 412 });
  // Mais alto que a janela: fica a 12 px do topo.
  expect(posicaoDoPopover(caixa(600, 400), { largura: 260, altura: 900 }, janela).top).toBe(12);
  expect(posicaoDoPopover(null, { largura: 260, altura: 100 }, janela)).toEqual({ left: 12, top: 48 });
});

test('sistema de botões: tamanhos e variantes por classe, IconButton com ícone (sem glifo de texto) e um chip só', () => {
  render(<><Button variante="primario" tamanho="md">Salvar</Button><Button variante="perigo" tamanho="sm">Apagar</Button><Button>Padrão</Button>
    <IconButton icone="xis" aria-label="Fechar" /><IconButton tamanho="sm" icone="reticencias" aria-label="Mais" />
    <Chip pressionado cor="#f00" conta={3}>Tese</Chip><a className={classesDoBotao({ tamanho: 'md' })} href="/x">Notas</a></>);
  expect(screen.getByRole('button', { name: 'Salvar' }).className).toContain('ui-primario ui-md');
  expect(screen.getByRole('button', { name: 'Apagar' }).className).toContain('ui-perigo ui-sm');
  expect(screen.getByRole('button', { name: 'Padrão' }).className).not.toMatch(/ui-(sm|md|lg)/);
  const fechar = screen.getByRole('button', { name: 'Fechar' });
  expect(fechar.className).toContain('ui-icon');
  expect(fechar.className).toContain('ui-md');
  expect(fechar.querySelector('svg')).not.toBeNull();
  expect(fechar.textContent).toBe('');
  expect(screen.getByRole('button', { name: 'Mais' }).className).toContain('ui-sm');
  const chip = screen.getByRole('button', { name: /Tese/ });
  expect(chip.className).toContain('ui-chip ui-chip-sm');
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  expect(chip.querySelector('.ui-chip-conta')?.textContent).toBe('3');
  expect(screen.getByRole('link', { name: 'Notas' }).className).toBe('ui-button ui-secundario ui-md');
});
