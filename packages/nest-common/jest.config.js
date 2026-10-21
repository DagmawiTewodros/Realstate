/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  transform: { "^.+\\.ts$": ["@swc/jest", { jsc: { parser: { syntax: "typescript", decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } }] },
};
