import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * `inventory` — one row per (user, item). Quantity-based, not document-per-copy.
 *
 * Items are flavour + collectibles. They are *never* required to solve a puzzle
 * (that would make progression paywalled and would give the client a lever), so
 * granting is entirely server-driven from mission rewards.
 */

export interface InventoryEntryDoc {
  _id: unknown;
  userId: string;
  itemId: string;
  quantity: number;
  /** Denormalised for the inventory grid; refreshed on award. */
  name: string;
  kind: string;
  description: string;
  rarity: string;
  sprite: string | null;
  acquiredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const inventorySchema = defineSchema<InventoryEntryDoc>(
  {
    userId: { type: String, required: true },
    itemId: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1, min: 0 },
    name: { type: String, required: true },
    kind: { type: String, required: true },
    description: { type: String, required: true, default: '' },
    rarity: { type: String, required: true, default: 'common' },
    sprite: { type: String, default: null },
    acquiredAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'inventory' },
);

inventorySchema.index({ userId: 1, itemId: 1 }, { unique: true });
inventorySchema.index({ userId: 1, rarity: -1, acquiredAt: -1 });

export const InventoryModel = registerModel<InventoryEntryDoc>('Inventory', inventorySchema);
