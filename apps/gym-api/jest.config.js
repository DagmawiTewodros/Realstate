/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test", "<rootDir>/src"],
  testTimeout: 30000,
  globalSetup: "<rootDir>/test/global-setup.ts",
  transform: {
    "^.+\\.ts$": [
      "@swc/jest",
      { jsc: { parser: { syntax: "typescript", decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, target: "es2022" } },
    ],
  },
};
