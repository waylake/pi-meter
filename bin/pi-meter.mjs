#!/usr/bin/env node
const features = process.features;
if (!features.typescript) {
  console.error(
    "pi-meter needs Node.js 22.18+ (or 23.6+) to run TypeScript directly.\n" +
      "Upgrade Node, or run the extension inside pi instead: pi -e ./pi-meter",
  );
  process.exit(1);
}

const { runCli } = await import("../src/cli.ts");

const code = await runCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  return 1;
});
process.exitCode = code;
