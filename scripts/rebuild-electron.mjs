import { spawnSync } from 'node:child_process'

function run(command, args, env = process.env) {
  const r = spawnSync(command, args, { stdio: 'inherit', shell: true, env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (process.platform === 'win32') {
  const env = { ...process.env, npm_config_msvs_enable_spectre_mitigation: 'false' }
  run('node', ['scripts/ensure-win-msvc.mjs'], env)
  run('node', ['scripts/patch-node-pty-binding.mjs'], env)
  run('electron-rebuild', ['-f', '--only', 'node-pty', '--types=prod'], env)
} else {
  run('electron-rebuild', ['-f', '--only', 'node-pty', '--types=prod'])
}
