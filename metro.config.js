const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const existing = config.resolver.blockList;
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Simulator recordings, runner builds, and skills are tooling, not app modules.
// Keeping them out of Metro also prevents their writes from interrupting gestures.
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  ...['.tooling', '.agents', 'artifacts'].map((directory) =>
    new RegExp(`^${escape(path.join(__dirname, directory))}[/\\\\].*`)
  ),
];

module.exports = config;
