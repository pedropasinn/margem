import { fireEvent, screen } from '@testing-library/react';
/** Escolhe pelo mesmo listbox operado pelo leitor, sem simular um select nativo. */
export function escolherOpcao(nome: string, opcao: string): void {
  fireEvent.click(screen.getByRole('combobox', { name: nome }));
  fireEvent.click(screen.getByRole('option', { name: opcao }));
}
