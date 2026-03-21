const { createTenant } = require("../src/tenantStore");

async function main() {
  const name = process.argv[2] || "test-user";
  const tenant = await createTenant(name);
  console.log(`Tenant: ${tenant.name}`);
  console.log(`Tenant ID: ${tenant.tenantId}`);
  console.log(`API Key: ${tenant.apiKey}`);
}

main().catch(error => {
  console.error("Failed to create tenant:", error.message);
  process.exitCode = 1;
});
