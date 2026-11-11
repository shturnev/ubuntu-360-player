const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_DEV_SERVER_PORT = 5173;
const DEV_SERVER_PORT_RANGE = 5;

function getProjectRoot() {
  return path.resolve(__dirname, '../..');
}

function loadProjectDotenv() {
  const projectRoot = getProjectRoot();
  const candidateFiles = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local'
  ];

  for (const fileName of candidateFiles) {
    const envPath = path.join(projectRoot, fileName);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenv.config({ path: envPath, processEnv: process.env });
    if (result.error) {
      throw result.error;
    }
  }

  return process.env;
}

function normalizePort(rawPort, options = {}) {
  const { defaultPort = DEFAULT_DEV_SERVER_PORT, portName = 'DEV_SERVER_PORT' } = options;
  const source = rawPort === undefined || rawPort === null || rawPort === '' ? defaultPort : rawPort;
  const normalized = String(source).trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid ${portName} value "${source}". Expected an integer between 1 and 65535.`);
  }

  const value = Number.parseInt(normalized, 10);

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid ${portName} value "${source}". Expected an integer between 1 and 65535.`);
  }

  return value;
}

function getCandidatePorts(rawPort, options = {}) {
  const { defaultPort = DEFAULT_DEV_SERVER_PORT, maxRange = DEV_SERVER_PORT_RANGE } = options;
  const basePort = normalizePort(rawPort, { defaultPort, portName: 'DEV_SERVER_PORT' });

  return Array.from({ length: maxRange }, (_, index) => basePort + index);
}

function getStorageRoot() {
  const baseDirectory = process.env.SHT_VR_HOME || process.env.HOME || os.homedir();
  return path.join(baseDirectory, '.sht-vr-player');
}

module.exports = {
  DEFAULT_DEV_SERVER_PORT,
  DEV_SERVER_PORT_RANGE,
  getCandidatePorts,
  getProjectRoot,
  getStorageRoot,
  loadProjectDotenv,
  normalizePort
};
