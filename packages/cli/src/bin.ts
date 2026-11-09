#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { run } from './main.js'

const interactive = !!(process.stdin.isTTY && process.stdout.isTTY)
const ask = async (q: string) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}

process.exitCode = await run(process.argv.slice(2), { fetch, log: (s) => console.log(s), interactive, ask })
