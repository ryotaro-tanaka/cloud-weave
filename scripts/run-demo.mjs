import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined))
env.VITE_SCREENSHOT_DEMO = '1'

const child = spawn(npmCommand, ['run', 'dev'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
