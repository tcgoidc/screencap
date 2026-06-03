const fs = require('fs')
const path = require('path')

const workspaceRoot = path.resolve(__dirname, '..')
const packageJsonPath = path.join(workspaceRoot, 'package.json')
const tauriConfigPath = path.join(workspaceRoot, 'src-tauri', 'tauri.conf.json')
const cargoTomlPath = path.join(workspaceRoot, 'src-tauri', 'Cargo.toml')

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const packageJson = readJson(packageJsonPath)
const tauriConfig = readJson(tauriConfigPath)
let hasChanges = false

if (tauriConfig.version !== packageJson.version) {
  tauriConfig.version = packageJson.version
  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`)
  hasChanges = true
}

const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8')
const syncedCargoToml = cargoToml.replace(
  /^(version\s*=\s*")[^"]+("\s*)$/m,
  `$1${packageJson.version}$2`
)

if (syncedCargoToml !== cargoToml) {
  fs.writeFileSync(cargoTomlPath, syncedCargoToml)
  hasChanges = true
}

if (hasChanges) {
  process.stdout.write(`Synced app version to ${packageJson.version}\n`)
}