import type { DecorItem } from "@/lib/types";
import { COUPLE_ID } from "./couple";

/** 15 decor items. 10 owned by the couple, 5 owned by other sellers. */
export const decor: DecorItem[] = [
  { id: "d1", name: "Peach Sofa", type: "furniture", rarity: "common", w: 3, h: 1, sprite: "sofa", ownerId: COUPLE_ID, forSale: false, description: "A squishy three-seater in sunset peach." },
  { id: "d2", name: "Monstera", type: "plant", rarity: "common", w: 1, h: 1, sprite: "plant", ownerId: COUPLE_ID, forSale: false, description: "Leafy and low-maintenance." },
  { id: "d3", name: "Woven Rug", type: "rug", rarity: "common", w: 3, h: 2, sprite: "rug", ownerId: COUPLE_ID, forSale: false, description: "Handwoven, warm under bare feet." },
  { id: "d4", name: "Cloud Bed", type: "furniture", rarity: "rare", w: 2, h: 2, sprite: "bed", ownerId: COUPLE_ID, forSale: false, description: "Feels like sleeping on a cumulus." },
  { id: "d5", name: "Retro TV", type: "appliance", rarity: "rare", w: 2, h: 1, sprite: "tv", ownerId: COUPLE_ID, forSale: false, description: "Perfect for movie nights." },
  { id: "d6", name: "Mint Fridge", type: "appliance", rarity: "common", w: 1, h: 2, sprite: "fridge", ownerId: COUPLE_ID, forSale: false, description: "Keeps the snacks chilly." },
  { id: "d7", name: "Tiny Stove", type: "appliance", rarity: "common", w: 1, h: 1, sprite: "stove", ownerId: COUPLE_ID, forSale: false, description: "For pancakes on Sundays." },
  { id: "d8", name: "Paper Lantern", type: "lighting", rarity: "rare", w: 1, h: 1, sprite: "lamp", ownerId: COUPLE_ID, forSale: true, priceUsdc: 18, description: "Casts a soft amber glow." },
  { id: "d9", name: "Bookshelf", type: "furniture", rarity: "common", w: 2, h: 1, sprite: "shelf", ownerId: COUPLE_ID, forSale: false, description: "Holds your favorite stories." },
  { id: "d10", name: "Starry Window", type: "wall", rarity: "epic", w: 2, h: 1, sprite: "window", ownerId: COUPLE_ID, forSale: true, priceUsdc: 75, description: "Always shows a night full of stars." },

  { id: "d11", name: "Arcade Cabinet", type: "appliance", rarity: "epic", w: 1, h: 2, sprite: "arcade", ownerId: "seller_kai", forSale: true, priceUsdc: 120, description: "Plays one game. It's a good game." },
  { id: "d12", name: "Cactus Trio", type: "plant", rarity: "common", w: 1, h: 1, sprite: "cactus", ownerId: "seller_ivy", forSale: true, priceUsdc: 6, description: "Three tiny friends, zero watering." },
  { id: "d13", name: "Velvet Armchair", type: "furniture", rarity: "rare", w: 1, h: 1, sprite: "chair", ownerId: "seller_ivy", forSale: true, priceUsdc: 32, description: "Deep green, deeply comfy." },
  { id: "d14", name: "Fairy Lights", type: "lighting", rarity: "common", w: 2, h: 1, sprite: "lights", ownerId: "seller_noor", forSale: false, description: "Twinkle twinkle." },
  { id: "d15", name: "Koi Aquarium", type: "furniture", rarity: "epic", w: 2, h: 1, sprite: "aquarium", ownerId: "seller_noor", forSale: false, description: "Two koi named Mochi and Bean." },
];
