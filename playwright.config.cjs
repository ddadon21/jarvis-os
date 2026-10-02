const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: /responsive\.spec\.cjs$/,
  timeout: 75_000,
  workers: 2,
  retries: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
});
