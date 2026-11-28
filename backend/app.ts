import mongoose from "mongoose";
import { connectDb } from "./src/db.ts";
import { verifyMailer } from "./src/lib/mailer.ts";
import { backfillDefaults } from "./src/lib/defaults.ts";
import { buildApp } from "./src/server.ts";
import { startOnchain, stopOnchain } from "./src/lib/ownership.ts";
import { startDecor, stopDecor } from "./src/lib/decor.ts";

const PORT = Number(process.env.PORT ?? 4000);

const app = await buildApp();

try {
  await connectDb(app.log);
  await backfillDefaults(app.log);
  await verifyMailer()
    .then(() => app.log.info("📮 SMTP ready"))
    .catch((err) => app.log.error({ err: err.message }, "📮 SMTP login failed — verification emails won't send"));
  await app.listen({ port: PORT, host: "0.0.0.0" });
  // Workspace ownership NFTs (off unless OWNERSHIP_CONTRACT and CHAIN_PRIVATE_KEY are set).
  await startOnchain(app.log);
  // NFT decor shop and marketplace (off unless DECOR_CONTRACT is set).
  await startDecor(app.log);
  app.log.info({ port: PORT, env: process.env.NODE_ENV ?? "development", requestLogs: process.env.LOG_REQUESTS !== "off" }, "🚀 API ready");
} catch (err) {
  app.log.error({ err: (err as Error).message, stack: (err as Error).stack }, "💥 API failed to start");
  process.exit(1);
}

// Close cleanly on Ctrl+C / container stop, so in-flight requests finish and Mongo disconnects.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "👋 Shutting down");
    await app.close();
    await stopOnchain();
    await stopDecor();
    await mongoose.disconnect();
    process.exit(0);
  });
}
