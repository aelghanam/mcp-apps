/**
 * Register only Horizon light/dark theme CSS (static imports so esbuild
 * does not pull every theme / i18n / icon pack via Assets.js).
 */
import { registerThemePropertiesLoader } from '@ui5/webcomponents-base/dist/asset-registries/Themes.js'

import themingHorizon from '@ui5/webcomponents-theming/dist/generated/assets/themes/sap_horizon/parameters-bundle.css.json'
import themingHorizonDark from '@ui5/webcomponents-theming/dist/generated/assets/themes/sap_horizon_dark/parameters-bundle.css.json'
import componentsHorizon from '@ui5/webcomponents/dist/generated/assets/themes/sap_horizon/parameters-bundle.css.json'
import componentsHorizonDark from '@ui5/webcomponents/dist/generated/assets/themes/sap_horizon_dark/parameters-bundle.css.json'

const theming = {
  sap_horizon: themingHorizon,
  sap_horizon_dark: themingHorizonDark
}
const components = {
  sap_horizon: componentsHorizon,
  sap_horizon_dark: componentsHorizonDark
}

async function loadTheming(themeName) {
  const data = theming[themeName]
  if (!data) throw new Error(`unknown theme: ${themeName}`)
  return data
}

async function loadComponents(themeName) {
  const data = components[themeName]
  if (!data) throw new Error(`unknown theme: ${themeName}`)
  return data
}

for (const name of Object.keys(theming)) {
  registerThemePropertiesLoader('@ui5/webcomponents-theming', name, loadTheming)
  registerThemePropertiesLoader('@ui5/webcomponents', name, loadComponents)
}
