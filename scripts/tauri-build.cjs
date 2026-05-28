const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const workspaceRoot = path.resolve(__dirname, '..')
const bundleRoot = path.join(workspaceRoot, 'src-tauri', 'target', 'release', 'bundle')

const stopRunningApp = () => {
  if (process.platform !== 'win32') {
    return
  }

  const result = spawnSync('taskkill', ['/IM', 'screencap.exe', '/F'], {
    cwd: workspaceRoot,
    stdio: 'ignore',
    windowsHide: true,
  })

  if (result.status !== 0 && result.status !== 128) {
    // Ignore "not found" style exit codes, but surface anything unexpected.
    const stderr = result.stderr ? result.stderr.toString() : ''
    if (stderr && stderr.toLowerCase().indexOf('not found') === -1) {
      process.stderr.write(stderr)
    }
  }
}

const runTauriBuild = () => {
  const cliScript = path.join(__dirname, 'tauri-cli.cjs')
  const result = spawnSync(process.execPath, [cliScript, 'build'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
    windowsHide: false,
  })

  if (result.status !== 0) {
    process.exit(typeof result.status === 'number' ? result.status : 1)
  }
}

const verifyArtifacts = () => {
  const msiDir = path.join(bundleRoot, 'msi')
  const nsisDir = path.join(bundleRoot, 'nsis')
  const msiArtifacts = fs.existsSync(msiDir) ? fs.readdirSync(msiDir).filter((entry) => /\.msi$/i.test(entry)) : []
  const nsisArtifacts = fs.existsSync(nsisDir) ? fs.readdirSync(nsisDir).filter((entry) => /\.exe$/i.test(entry)) : []

  if (msiArtifacts.length === 0 || nsisArtifacts.length === 0) {
    process.stderr.write('Expected MSI and NSIS bundle artifacts were not produced.\n')
    process.exit(1)
  }

  process.stdout.write(`Verified MSI artifact: ${path.join(msiDir, msiArtifacts[0])}\n`)
  process.stdout.write(`Verified NSIS artifact: ${path.join(nsisDir, nsisArtifacts[0])}\n`)
}

stopRunningApp()
runTauriBuild()
verifyArtifacts()