const binding = require('../node_modules/@tauri-apps/cli-win32-x64-msvc')
require('./sync-version.cjs')

const cargoBinPath = 'D:\\Users\\it0116\\.cargo\\bin'

if (!process.env.PATH || !process.env.PATH.split(';').includes(cargoBinPath)) {
  process.env.PATH = process.env.PATH
    ? `${cargoBinPath};${process.env.PATH}`
    : cargoBinPath
}

const args = process.argv.slice(2)
const binName = process.env.npm_lifecycle_event
  ? `npm run ${process.env.npm_lifecycle_event}`
  : 'node scripts/tauri-cli.cjs'

binding.run(args, binName, (error) => {
  if (error) {
    binding.logError(error.message)
    process.exit(1)
  }
})