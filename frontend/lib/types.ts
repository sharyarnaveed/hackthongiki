export type Mode = "office" | "home";
export type ThemePref = "light" | "dark" | "system";
export type Presence = "online" | "busy" | "away" | "offline";
export type Rarity = "common" | "rare" | "epic";
export type ID = string;

export interface User {
  id: ID;
  name: string;
  email: string;
  avatarUrl?: string;
  /** hex used for generated avatars */
  color: string;
  title?: string;
  status: Presence;
  statusText?: string;
}

/* ---------------- Office ---------------- */
export interface Workspace {
  id: ID;
  name: string;
  slug: string;
  icon: string; // emoji or short glyph
  color: string;
  memberIds: ID[];
  createdAt: string;
}

export type RoomKind = "meeting" | "focus" | "lounge" | "open";
export interface Room {
  id: ID;
  workspaceId: ID;
  name: string;
  kind: RoomKind;
  capacity: number;
  /** placement on the office floor, in grid units */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Member {
  userId: ID;
  workspaceId: ID;
  role: "owner" | "admin" | "member";
  roomId: ID | null;
}

export interface Channel {
  id: ID;
  workspaceId: ID | null; // null = couple chat
  name: string;
  topic?: string;
  unread: number;
}

export interface Message {
  id: ID;
  channelId: ID;
  authorId: ID;
  body: string;
  createdAt: string;
  reactions?: { emoji: string; userIds: ID[] }[];
}

export type FileKind = "doc" | "sheet" | "slide" | "image" | "video" | "pdf" | "zip" | "code";
export interface FileItem {
  id: ID;
  workspaceId: ID;
  name: string;
  kind: FileKind;
  sizeBytes: number;
  ownerId: ID;
  updatedAt: string;
}

/* ---------------- Home ---------------- */
export type HouseRoomKind = "living" | "bedroom" | "kitchen";
export interface HouseRoom {
  id: ID;
  kind: HouseRoomKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;
export interface PlacedItem {
  instanceId: ID;
  itemId: ID; // DecorItem.id
  x: number;
  y: number;
  rotation: Rotation;
}

export interface House {
  id: ID;
  coupleId: ID;
  cols: number;
  rows: number;
  rooms: HouseRoom[];
  placed: PlacedItem[];
  /** where each partner is standing, tile coords */
  positions: Record<ID, { x: number; y: number }>;
}

export interface Couple {
  id: ID;
  partnerIds: [ID, ID];
  houseId: ID;
  inviteCode: string;
  since: string;
}

export type DecorType = "furniture" | "plant" | "lighting" | "rug" | "wall" | "appliance";
export interface DecorItem {
  id: ID;
  name: string;
  type: DecorType;
  rarity: Rarity;
  /** footprint in tiles at rotation 0 */
  w: number;
  h: number;
  /** pixel sprite key, see lib/pixel/sprites.ts */
  sprite: string;
  ownerId: ID | null; // null = not owned by the couple
  forSale: boolean;
  priceUsdc?: number;
  description: string;
}

export interface Listing {
  id: ID;
  itemId: ID;
  sellerId: ID;
  sellerName: string;
  priceUsdc: number;
  listedAt: string;
}

export interface SavingsGoal {
  id: ID;
  name: string;
  emoji: string;
  targetUsdc: number;
  savedUsdc: number;
  dueDate?: string;
}

export type TxStatus = "pending" | "approved" | "rejected" | "completed";
export type TxKind = "deposit" | "withdraw" | "purchase" | "sale" | "goal";
export interface Transaction {
  id: ID;
  kind: TxKind;
  label: string;
  amountUsdc: number; // positive in, negative out
  createdAt: string;
  createdBy: ID;
  status: TxStatus;
  approvals: ID[]; // partners who approved
  rejectedBy?: ID;
}

export interface Wallet {
  id: ID;
  coupleId: ID;
  address: string;
  balanceUsdc: number;
  goals: SavingsGoal[];
  transactions: Transaction[];
}

export interface Memory {
  id: ID;
  coupleId: ID;
  title: string;
  note: string;
  /** placeholder photo: a CSS gradient */
  gradient: string;
  emoji: string;
  date: string;
  authorId: ID;
}
