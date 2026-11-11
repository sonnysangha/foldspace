const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['.tooling/**', '.agents/**', 'convex/_generated/**', 'ios/**', 'android/**', 'dist/**'] },
]);
