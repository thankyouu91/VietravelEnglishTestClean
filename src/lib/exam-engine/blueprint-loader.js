const fs = require('fs');
const path = require('path');

const BLUEPRINTS_FILE = path.join(__dirname, '..', '..', '..', 'data', 'exam-blueprints.json');

let cachedBlueprints = null;

function loadBlueprints() {
  if (cachedBlueprints) return cachedBlueprints;
  if (fs.existsSync(BLUEPRINTS_FILE)) {
    try {
      cachedBlueprints = JSON.parse(fs.readFileSync(BLUEPRINTS_FILE, 'utf8'));
      return cachedBlueprints;
    } catch (err) {
      console.error('[blueprint-loader] Failed to parse exam-blueprints.json:', err);
    }
  }
  return {};
}

function getBlueprint(version) {
  const blueprints = loadBlueprints();
  return blueprints[version] || null;
}

module.exports = {
  loadBlueprints,
  getBlueprint
};
