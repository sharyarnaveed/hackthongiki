import mongoose from "mongoose";

export const DB_NAME = process.env.DB_NAME ?? "pixelart_office";

type Log = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };

export async function connectDb(log?: Log) {
  const uri = process.env.MONGODB;
  if (!uri) throw new Error("MONGODB is not set in backend/.env");
  const started = performance.now();
  await mongoose.connect(uri, { dbName: DB_NAME });
  const host = mongoose.connection.host;
  if (log) {
    log.info({ db: DB_NAME, host, ms: Math.round(performance.now() - started) }, "🍃 MongoDB connected");
    mongoose.connection.on("disconnected", () => log.warn({ db: DB_NAME }, "🍃 MongoDB disconnected"));
    mongoose.connection.on("reconnected", () => log.info({ db: DB_NAME }, "🍃 MongoDB reconnected"));
    mongoose.connection.on("error", (err) => log.error({ err: err.message }, "🍃 MongoDB error"));
  } else console.log(`MongoDB connected (db: ${DB_NAME})`);
}
