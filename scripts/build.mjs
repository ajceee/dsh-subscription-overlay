import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const bin = (name) => fileURLToPath(new URL(`../node_modules/.bin/${name}${process.platform === 'win32' ? '.cmd' : ''}`, import.meta.url))
const run = (name, args) => execFileSync(bin(name), args, {
  stdio: 'inherit', shell: process.platform === 'win32',
})
run('tsc', ['-p', 'tsconfig.json'])
run('tsdown', [])
