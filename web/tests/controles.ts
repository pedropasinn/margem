import type { Page } from 'playwright';
export async function escolherOpcao(pagina: Page, nome: string, rotulo: string): Promise<void> {
  await pagina.getByRole('combobox', { name: nome, exact: true }).click();
  await pagina.getByRole('option', { name: rotulo, exact: true }).click();
}
export async function abrirOpcoes(pagina: Page): Promise<void> {
  const botao = pagina.getByRole('button', { name: 'Marcas e opções' });
  if (await botao.getAttribute('aria-expanded') !== 'true') await botao.click();
}
