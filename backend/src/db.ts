import mongoose from "mongoose";

const DB_NAME = process.env.DB_NAME ?? "pixelart_office";

export async function connectDb() {
  const uri = process.env.MONGODB;
  if (!uri) throw new Error("MONGODB is not set in backend/.env");
  await mongoose.connect(uri, { dbName: DB_NAME });
  console.log(`MongoDB connected (db: ${DB_NAME})`);
}
