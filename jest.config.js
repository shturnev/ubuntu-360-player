module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|scss)$': '<rootDir>/tests/unit/styleMock.js',
  },
  setupFiles: ['<rootDir>/tests/setupTempDir.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupSkipSymlink.js'],
  testMatch: ['**/tests/unit/**/*.spec.[jt]s?(x)'],
  moduleFileExtensions: ['js', 'jsx', 'json'],
};
