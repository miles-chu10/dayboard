// Backend files reach the same native boundary from different relative depths.
// Fixture maps use one key so no test accidentally loads Electron or personal app state.
export function fixtureImport(specifier) {
  return /(?:^|\/)platform\/index\.(?:js|ts)$/.test(specifier) ? "dayboard:platform" : specifier;
}
