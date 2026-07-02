import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const cardSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(8),
  answer: z.string().min(20),
  category: z.string().min(1),
  examRelevance: z.enum(["high", "medium", "low"]),
  sourcePages: z.array(z.number().int().positive()).min(1),
  highlights: z.array(z.string()).default([]),
  importantGraphic: z.boolean().default(false),
  media: z.array(z.string()).default([])
});

const dataSchema = z.object({
  cards: z.array(cardSchema)
});

export async function validateCards(file = path.join(process.cwd(), "public", "data", "cards.json")) {
  const raw = await fs.readFile(file, "utf8");
  const data = dataSchema.parse(JSON.parse(raw));
  const ids = new Set();
  for (const card of data.cards) {
    if (ids.has(card.id)) throw new Error(`Duplicate card id: ${card.id}`);
    ids.add(card.id);
  }
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await validateCards();
  console.log(`Validated ${data.cards.length} cards.`);
}
