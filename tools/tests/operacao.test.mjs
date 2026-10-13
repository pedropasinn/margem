import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pausa } from 'node:timers/promises';
const raiz = fileURLToPath(new URL('../../', import.meta.url));

test('remover job recusa alterações e branch não integrada; depois remove as duas', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'margem-limpeza-'));
  try {
    const repo = join(tmp, 'margem'); await mkdir(join(repo, 'tools'), { recursive: true });
    await copyFile(join(raiz, 'tools/remover-job.sh'), join(repo, 'tools/remover-job.sh'));
    const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
    git('init', '-b', 'main'); git('config', 'user.name', 'Teste local'); git('config', 'user.email', 'teste@localhost');
    git('add', '.'); git('commit', '-m', 'base');
    const wt = join(tmp, 'margem-wt/j99'); git('worktree', 'add', '-b', 'j99', wt);
    const limpar = () => execFileSync('bash', ['tools/remover-job.sh', 'J99'], { cwd: repo, stdio: 'pipe' });
    await writeFile(join(wt, 'alteracao.txt'), 'preservar');
    assert.throws(limpar, /alterações/);
    git('-C', wt, 'add', '.'); git('-C', wt, 'commit', '-m', 'mudança');
    assert.throws(limpar, /não mesclada/);
    git('merge', '--ff-only', 'j99'); limpar();
    assert.throws(() => git('show-ref', '--verify', 'refs/heads/j99'));
    assert.ok(!git('worktree', 'list').includes(wt));
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('dev inicia API, worker e Vite com origens corretas e encerra os filhos', { timeout: 20000 }, async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'margem-dev-'));
  let processo; const pids = [];
  try {
    for (const p of ['tools', 'servico/src/worker', 'web/node_modules/vite/bin']) await mkdir(join(tmp, p), { recursive: true });
    await copyFile(join(raiz, 'tools/dev.mjs'), join(tmp, 'tools/dev.mjs'));
    await symlink(join(raiz, 'node_modules'), join(tmp, 'node_modules'));
    await writeFile(join(tmp, 'package.json'), '{"type":"module"}');
    await writeFile(join(tmp, 'web/package.json'), '{"type":"module"}');
    await writeFile(join(tmp, 'web/node_modules/vite/package.json'), '{"name":"vite","type":"module"}');
    for (const [nome, caminho] of [['api','servico/src/api.ts'],['worker','servico/src/worker/main.ts'],['web','web/node_modules/vite/bin/vite.js']]) {
      await writeFile(join(tmp, caminho), `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(join(tmp, nome+'.json'))}, JSON.stringify({cwd:process.cwd(),pid:process.pid,porta:process.env.MARGEM_PORTA,origens:process.env.MARGEM_ORIGENS,args:process.argv.slice(2)}));
setInterval(()=>{},1000);`);
    }
    processo = spawn(process.execPath, ['tools/dev.mjs'], { cwd: tmp, env: { ...process.env, MARGEM_PORTA:'18830', MARGEM_PORTA_WEB:'18880', MARGEM_ORIGENS:'https://origem.local', MARGEM_TAILSCALE_HOST:'leitor.local' }, stdio:'pipe' });
    let erros=''; processo.stderr.on('data', d=>{erros+=d;});
    const fim=once(processo,'exit');
    for (const nome of ['api','worker','web']) {
      let dado;
      for (let tentativa=0;tentativa<100;tentativa++) {
        try { dado=JSON.parse(await readFile(join(tmp,nome+'.json'),'utf8'));break; } catch { await pausa(50); }
      }
      assert.ok(dado,`${nome} não iniciou: ${erros}`); pids.push(dado.pid);
      assert.equal(dado.porta,'18830');
      assert.equal(dado.cwd,nome==='web'?join(tmp,'web'):tmp);
      for (const origem of ['https://origem.local','https://leitor.local','http://localhost:18880','http://127.0.0.1:18830']) assert.ok(dado.origens.split(',').includes(origem));
      if(nome==='web') assert.deepEqual(dado.args,['--host','127.0.0.1','--port','18880','--strictPort']);
    }
    processo.kill('SIGTERM');
    const [codigo]=await fim; assert.equal(codigo,0);
    for(const pid of pids) assert.throws(()=>process.kill(pid,0));
  } finally {
    processo?.kill('SIGTERM');
    for(const pid of pids) { try{process.kill(pid,'SIGTERM');}catch{} }
    await rm(tmp,{recursive:true,force:true});
  }
});
