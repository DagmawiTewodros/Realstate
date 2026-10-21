/** Test environment. The test database is created fresh by global-setup.ts. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/property_test";

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "4999",
  DATABASE_URL: TEST_DATABASE_URL,
  SESSION_SECRET: "test-session-secret-that-is-long-enough-123",
  PUBLIC_WEB_URL: "http://localhost:3000",
  CORS_ORIGINS: "http://localhost:3000",
  AUTOMATION_MODE: "direct",
  WEBHOOK_SIGNING_SECRET: "test-webhook-secret-123",
  INTERNAL_API_SECRET: "test-internal-secret-123",
  DISPATCHER_ENABLED: "false",
  SCHEDULER_ENABLED: "false",
  STORAGE_DRIVER: "local",
  STORAGE_DIR: "/tmp/property-api-test-storage",
  COMPANY_NAME: "Test Realty",
};
