# Testes entre componentes

Esta pasta reúne cenários que atravessam a aplicação inteira. Os testes próprios
de cada componente continuam junto dele: `motor/tests`, `servico/src`, `core/src`,
`contratos/testes` e `web/`.

## Resiliência de ponta a ponta

Na raiz do repositório:

```sh
npm run e2e
```

O comando recompila a interface e executa `e2e/resiliencia.ts` contra API, worker,
motor Python, Postgres e Chromium reais. O executor de IA é falso e determinístico;
não há chamada ao Codex. São necessários o container Postgres, sua configuração
local, o venv Python e o Chromium do Playwright já provisionados.

O cenário verifica texto disponível sem worker, interrupção e retomada de um job,
publicação sem duplicação, falha de marcação, retomada da posição e notas no celular.
Cria um banco com nome exclusivo e diretórios temporários; limpa-os ao terminar,
inclusive em caso de falha. A API de teste usa a porta local 8732, que deve estar livre.

As capturas da execução ficam em `e2e/saida/capturas/`, ignoradas pelo Git. São
evidências para inspeção, não imagens de referência para comparação automática.
As capturas originais do J10 estão em `docs/historico/capturas-j10/`.

`npm test` executa as suítes Vitest; não executa este cenário. `npm run typecheck`
também verifica o TypeScript do E2E.
