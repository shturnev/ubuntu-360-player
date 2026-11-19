if (process.platform === 'win32') {
  // Windows may expose the temporary directory through an 8.3 alias.
  process.env.TEMP = require('fs').realpathSync(require('os').tmpdir());
}

module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|scss)$': '<rootDir>/tests/unit/styleMock.js',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setupSkipSymlink.js'],
  testMatch: ['**/tests/unit/**/*.spec.[jt]s?(x)'],
  moduleFileExtensions: ['js', 'jsx', 'json'],
};
