/** Barrel of every Mongoose model. Imported once at startup so all indexes get built. */
import { RefreshTokenModel, UserModel } from './modules/auth/model.js';
import { MessageModel } from './modules/chat/model.js';
import { CoupleInviteModel, CoupleModel } from './modules/couples/model.js';
import { DecorItemModel, HouseModel } from './modules/house/model.js';
import { NftOwnershipModel } from './modules/inventory/model.js';
import { KeyBackupModel } from './modules/keys/model.js';
import { ListingModel } from './modules/marketplace/model.js';
import { MemoryModel } from './modules/memories/model.js';
import { RoomModel } from './modules/rooms/model.js';
import { CoupleWalletModel, WalletApprovalModel, WalletModel } from './modules/wallet/model.js';
import { WebhookEventModel } from './modules/webhooks/model.js';
import { WorkspaceInviteModel, WorkspaceModel } from './modules/workspaces/model.js';

export const allModels = [
  UserModel,
  RefreshTokenModel,
  KeyBackupModel,
  WorkspaceModel,
  WorkspaceInviteModel,
  RoomModel,
  CoupleModel,
  CoupleInviteModel,
  MessageModel,
  MemoryModel,
  DecorItemModel,
  HouseModel,
  NftOwnershipModel,
  ListingModel,
  WalletModel,
  CoupleWalletModel,
  WalletApprovalModel,
  WebhookEventModel,
] as const;

export {
  CoupleInviteModel,
  CoupleModel,
  CoupleWalletModel,
  DecorItemModel,
  HouseModel,
  KeyBackupModel,
  ListingModel,
  MemoryModel,
  MessageModel,
  NftOwnershipModel,
  RefreshTokenModel,
  RoomModel,
  UserModel,
  WalletApprovalModel,
  WalletModel,
  WebhookEventModel,
  WorkspaceInviteModel,
  WorkspaceModel,
};
