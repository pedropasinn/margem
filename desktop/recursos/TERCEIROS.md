# Programas de terceiros no app de desktop

O app de desktop do Margem (licença AGPL-3.0-only) leva, ao lado do próprio código, os programas abaixo.
Cada um é um **executável separado**, chamado como processo (nunca ligado ao código do Margem), e
mantém a própria licença. As versões e os sha256 estão fixados em `desktop/recursos/versoes.json`; o
`preparar.mjs` baixa de cada fonte oficial e recusa qualquer byte diferente. Os textos das licenças
vão em `licencas/` dentro de cada pasta de plataforma.

| Programa | Versão | Licença | Fonte | Plataformas |
|---|---|---|---|---|
| PostgreSQL (servidor, `initdb`, `pg_ctl`) | 18.6 | PostgreSQL License (permissiva, estilo BSD/MIT) | macOS e Linux: [zonky embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries) 18.6.0 no Maven Central (`io.zonky.test.postgres`, artefatos assinados). Windows: zip oficial de binários da [EDB](https://www.enterprisedb.com/download-postgresql-binaries) 18.6-1 (só `bin/`, `lib/`, `share/`) | as quatro |
| Codex CLI | 0.162.1 | Apache-2.0 | [openai/codex](https://github.com/openai/codex/releases/tag/rust-v0.162.1), `codex-package-<alvo>.tar.gz` (sem `codex-resources/voice`) | as quatro |
| ripgrep (`codex-path/rg`, dentro do pacote do Codex) | a do pacote | MIT ou Unlicense | idem | as quatro |
| bubblewrap (`codex-resources/bwrap`, dentro do pacote do Codex) | a do pacote | LGPL-2.0-or-later | idem | Linux |
| zsh (`codex-resources/zsh`, dentro do pacote do Codex) | a do pacote | licença MIT-like do zsh | idem | Linux, macOS |
| yt-dlp (executável standalone) | 2026.08.19 | Unlicense; o executável embute CPython (PSF) e dependências com as próprias licenças | [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19): `yt-dlp_linux`, `yt-dlp_macos` (universal), `yt-dlp.exe` | as quatro |
| FFmpeg (`ffmpeg`, `ffprobe`; no Linux com as bibliotecas `libav*`/`libsw*` em `lib/`) | Linux 8.1.3; Windows e macOS 6.1.1/6.x | **GPL-3.0-or-later** (builds com `--enable-gpl`, `--enable-version3`) | Linux: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08) `n8.1.3 linux64-gpl-shared` (J116: a variante shared divide as bibliotecas entre os dois programas). Windows e macOS: release [b6.1.1 do ffmpeg-static](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1), que republica: Windows de [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 6.1.1 essentials; macOS x64 de [evermeet.cx](https://evermeet.cx/ffmpeg/) 6.1.1; macOS arm64 de [osxexperts.net](https://www.osxexperts.net/) (série 6) | as quatro |
| Runtime do Visual C++ (`msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`, em `postgres/bin/`) | a do Windows que monta (o runner do CI) | licença do Visual Studio: arquivos redistribuíveis, distribuição app-local permitida | System32 da máquina que monta (o `postgres.exe` da EDB depende dele e o zip não o traz) | Windows |
| DejaVu Sans (`fontes/DejaVuSans.ttf`) | 2.37 | licença da Bitstream Vera + domínio público das mudanças do DejaVu | [dejavu-fonts](https://github.com/dejavu-fonts/dejavu-fonts/releases/tag/version_2_37) | as quatro |
| Motor do Margem congelado (`motor/margem-motor`) | o do repositório | AGPL-3.0-only (o motor); dentro dele: CPython 3.12 (PSF-2.0), PyMuPDF 1.28.2 e MuPDF (**AGPL-3.0**), numpy 2.5.4 (BSD-3-Clause; com OpenBLAS, BSD-3-Clause, e libgfortran, GPL com exceção de runtime), PyInstaller (bootloader GPL-2.0 com exceção para executáveis) | construído a partir de `motor/` por `motor/empacotar/construir.py` | as quatro (cada sistema constrói o seu) |

## Compatibilidade com a AGPL

- PostgreSQL, Codex, ripgrep, yt-dlp e DejaVu têm licenças permissivas; bubblewrap é LGPL; nenhum
  impõe condição além de levar o aviso de licença, que vai em `licencas/`.
- O FFmpeg estático é GPL-3.0-or-later. Ele vai como programa separado (agregado, no sentido da GPL), e a
  GPLv3 é compatível com a AGPLv3. Obrigações ao distribuir: levar o texto da licença
  (`licencas/ffmpeg.LICENSE`) e oferecer o código-fonte correspondente — os builds citados apontam o
  commit do FFmpeg e das bibliotecas (`licencas/ffmpeg.README`); a página de download do Margem deve
  repetir esse ponteiro.
- PyMuPDF/MuPDF já são AGPL-3.0, a mesma licença do Margem.

## Notas de proveniência

- O build macOS arm64 do ffmpeg-static vem de osxexperts.net, que não publica assinatura; os outros
  vêm de fontes que publicam a configuração do build.
- O build Linux do ffmpeg-static (johnvansickle 7.0.2) foi trocado pelo do BtbN: sem libharfbuzz, o
  FFmpeg 7+ não tem o filtro `drawtext`, que a arte usa. No FFmpeg 6 (Windows e macOS) o `drawtext`
  só precisa do libfreetype, que os três builds têm (conferido nas strings de configuração). Se a revisão jurídica ou de segurança pedir,
  trocar só esse arquivo por um build assinado (ex.: martin-riedl.de) em `versoes.json`.
- O PostgreSQL do zonky para Linux traz `libssl.so.1.1` e `libxml2` próprios em `postgres/lib/`; o
  banco do app só escuta em 127.0.0.1 e não usa TLS.
- O zonky só traz `initdb`, `pg_ctl` e `postgres` (sem `psql`/`pg_dump`). Do zip da EDB também só ficam
  esses três, com as DLLs que eles e os módulos de `lib/` importam (J116, `enxugarPostgres`); os
  clientes, o StackBuilder, o ECPG, as bibliotecas estáticas, as traduções e `include/` saem.
