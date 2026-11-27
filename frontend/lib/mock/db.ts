/**
 * In-memory mock "database". Mutated only by lib/mock/api/*.
 * Resets on reload. Replace lib/mock/api with real calls later.
 */
import { users } from "./data/users";
import { workspaces, rooms, members } from "./data/workspaces";
import { channels, messages } from "./data/chat";
import { files } from "./data/files";
import { couple, house } from "./data/couple";
import { decor } from "./data/decor";
import { listings } from "./data/marketplace";
import { wallet } from "./data/wallet";
import { memories } from "./data/memories";

export const db = structuredClone({
  users, workspaces, rooms, members, channels, messages, files,
  couple, house, decor, listings, wallet, memories,
});
