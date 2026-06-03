import { renderAboutLayout } from './about-layout.js'
import { APP_REPOSITORY_URL } from './app-meta.js'
import { openExternalUrl } from './tauri-runtime.js'
import './styles.css'

const aboutApp = document.querySelector<HTMLDivElement>('#about-app')

if (!aboutApp) {
  throw new Error('About app root was not found')
}

aboutApp.innerHTML = `
  <main class="main-panel about-page-panel">
    <h1>About Screencap</h1>
    <p>Application identity, release information, and project source are collected on this standalone page.</p>
    ${renderAboutLayout()}
  </main>
`

const repositoryLink = document.querySelector<HTMLAnchorElement>('.about-layout-link')

repositoryLink?.addEventListener('click', (event) => {
  event.preventDefault()
  void openExternalUrl(APP_REPOSITORY_URL)
})