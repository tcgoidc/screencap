import {
  APP_CREDITS_LABEL,
  APP_NAME_LABEL,
  APP_RELEASE_DATE_LABEL,
  APP_REPOSITORY_URL,
  APP_VERSION_LABEL,
} from './app-meta.js'

type AboutLayoutVariant = 'default' | 'overlay'

export const renderAboutLayout = (variant: AboutLayoutVariant = 'default'): string => `
  <section class="about-layout about-layout-${variant}" id="about-panel" aria-label="About Screencap">
    <div class="about-layout-header">
      <div>
        <p class="about-layout-eyebrow">About</p>
        <h2 class="about-layout-title">${APP_NAME_LABEL}</h2>
      </div>
      <span class="about-layout-badge">${APP_VERSION_LABEL}</span>
    </div>
    <p class="about-layout-credit">${APP_CREDITS_LABEL}</p>
    <div class="about-layout-details">
      <span>${APP_RELEASE_DATE_LABEL}</span>
      <a class="about-layout-link" href="${APP_REPOSITORY_URL}" target="_blank" rel="noreferrer">${APP_REPOSITORY_URL}</a>
    </div>
  </section>
`