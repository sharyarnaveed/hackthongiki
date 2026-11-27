/**
 * The single swap point for data access.
 * Screens import `api` from "@/lib/mock" and types from "@/lib/types" only.
 * To go live, re-implement these modules against real endpoints
 * keeping the same signatures.
 */
import * as auth from "./api/auth";
import * as office from "./api/office";
import * as chat from "./api/chat";
import * as files from "./api/files";
import * as home from "./api/home";
import * as marketplace from "./api/marketplace";
import * as wallet from "./api/wallet";
import * as memories from "./api/memories";

export const api = { auth, office, chat, files, home, marketplace, wallet, memories };
export type Api = typeof api;
export type { MemberWithUser } from "./api/office";
export type { ListingWithItem, ListingFilters } from "./api/marketplace";
export { CURRENT_USER_ID, PARTNER_ID } from "./data/users";
