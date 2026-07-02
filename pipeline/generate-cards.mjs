import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { renderPages } from "./render-pages.mjs";
import { validateCards } from "./validate-cards.mjs";

const root = process.cwd();
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const batchSize = Number(process.env.BATCH_SIZE || 5);
const requestedModel = process.env.GEMINI_MODEL || "";
const retryAttempts = Number(process.env.RETRY_ATTEMPTS || 4);
const rateDelayMs = Number(process.env.RATE_DELAY_MS || 13000);
const outputDir = path.join(root, "pipeline", "output");
const mediaDir = path.join(root, "public", "media");
const cardsPath = path.join(root, "public", "data", "cards.json");

if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY. Put it in .env.local or pass it as an environment variable.");
}

const schema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          category: { type: "string" },
          examRelevance: { type: "string", enum: ["high", "medium", "low"] },
          sourcePages: { type: "array", items: { type: "integer" } },
          highlights: { type: "array", items: { type: "string" } },
          importantGraphic: { type: "boolean" },
          graphicPages: { type: "array", items: { type: "integer" } }
        },
        required: [
          "question",
          "answer",
          "category",
          "examRelevance",
          "sourcePages",
          "highlights",
          "importantGraphic",
          "graphicPages"
        ]
      }
    }
  },
  required: ["cards"]
};

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fileToInlineData(file) {
  return {
    inlineData: {
      mimeType: "image/webp",
      data: await fs.readFile(file, "base64")
    }
  };
}

async function chooseModel() {
  if (requestedModel) return requestedModel;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!response.ok) return "gemini-2.5-flash";
  const data = await response.json();
  const names = (data.models || [])
    .map((model) => model.name?.replace("models/", ""))
    .filter(Boolean);
  return (
    names.find((name) => /gemini-3.*flash/i.test(name)) ||
    names.find((name) => /gemini-2\.5.*flash/i.test(name)) ||
    names.find((name) => /flash/i.test(name)) ||
    "gemini-2.5-flash"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayFromError(status, body, attempt) {
  const retryMatch = body.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (retryMatch) return (Number(retryMatch[1]) + 2) * 1000;
  if (status === 429) return 62000;
  if (status === 503) return Math.min(120000, 10000 * 2 ** attempt);
  return 0;
}

function promptForBatch(pages) {
  const pageList = pages.map((page) => page.page).join(", ");
  return `
Du bist ein strenger Pruefungsvorbereiter. Erstelle aus den PDF-Seiten ${pageList} hochwertige Anki-Karten.

Regeln:
- Nur pruefungsrelevante Inhalte, keine Trivia.
- Jede Frage muss eindeutig und lernbar sein.
- Jede Antwort muss voll ausformuliert sein, nicht nur Stichworte.
- Nutze Kategorien wie Themengebiete, Methoden, Begriffe, Prozesse oder Pruefungsfallen.
- Markiere wichtige Begriffe in "highlights".
- Wenn eine Seite eine wichtige Grafik, Tabelle, Matrix, Abbildung oder Schema enthaelt, setze importantGraphic=true und trage die Seitenzahl in graphicPages ein.
- Antworte ausschliesslich im vorgegebenen JSON-Schema.
- Erzeuge lieber weniger, dafuer gute Karten.
`;
}

async function callGemini(model, pages) {
  const parts = [{ text: promptForBatch(pages) }];
  for (const page of pages) {
    parts.push({ text: `PDF-Seite ${page.page}` });
    parts.push(await fileToInlineData(page.imagePath));
  }

  const request = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.25,
      responseMimeType: "application/json",
      responseSchema: schema
    }
  };

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      }
    );

    if (response.ok) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
      if (!text) throw new Error("Gemini returned no JSON text.");
      return JSON.parse(text);
    }

    const body = await response.text();
    const canRetry = [429, 500, 502, 503, 504].includes(response.status) && attempt < retryAttempts;
    if (!canRetry) throw new Error(`Gemini request failed (${response.status}): ${body}`);
    const waitMs = retryDelayFromError(response.status, body, attempt);
    console.warn(`Gemini ${response.status}; retrying in ${Math.round(waitMs / 1000)}s.`);
    await sleep(waitMs);
  }

  throw new Error("Gemini retry loop exhausted.");
}

function makeId(card, index) {
  const hash = crypto
    .createHash("sha1")
    .update(`${card.question}|${card.sourcePages?.join(",")}|${index}`)
    .digest("hex")
    .slice(0, 12);
  return `card-${hash}`;
}

async function copyGraphicPages(cards, pageMap) {
  await fs.mkdir(mediaDir, { recursive: true });
  for (const card of cards) {
    const pages = new Set([...(card.importantGraphic ? card.graphicPages || [] : [])]);
    card.media = [];
    for (const page of pages) {
      const source = pageMap.get(page);
      if (!source) continue;
      const targetName = `page-${String(page).padStart(3, "0")}.webp`;
      const target = path.join(mediaDir, targetName);
      await fs.copyFile(source, target);
      card.media.push(`/media/${targetName}`);
    }
    delete card.graphicPages;
  }
}

async function writeCurrentOutputs({ allCards, errors, model, pages, pageMap }) {
  const normalized = allCards.map((card, index) => ({
    id: makeId(card, index),
    question: String(card.question || "").trim(),
    answer: String(card.answer || "").trim(),
    category: String(card.category || "Allgemein").trim(),
    examRelevance: ["high", "medium", "low"].includes(card.examRelevance) ? card.examRelevance : "medium",
    sourcePages: Array.isArray(card.sourcePages) ? card.sourcePages.map(Number).filter(Boolean) : [],
    highlights: Array.isArray(card.highlights) ? card.highlights.map(String).slice(0, 8) : [],
    importantGraphic: Boolean(card.importantGraphic),
    graphicPages: Array.isArray(card.graphicPages) ? card.graphicPages.map(Number).filter(Boolean) : []
  })).filter((card) => card.question && card.answer && card.sourcePages.length);

  await copyGraphicPages(normalized, pageMap);
  const output = { cards: normalized };
  await fs.writeFile(cardsPath, JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, "cards.raw.json"), JSON.stringify(allCards, null, 2), "utf8");
  await fs.writeFile(
    path.join(outputDir, "pipeline-report.json"),
    JSON.stringify({ model, pageCount: pages.length, cardCount: normalized.length, errors }, null, 2),
    "utf8"
  );

  if (normalized.length) await validateCards(cardsPath);
  return normalized;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.dirname(cardsPath), { recursive: true });
  const model = await chooseModel();
  const pages = await renderPages();
  const pageMap = new Map(pages.map((page) => [page.page, page.imagePath]));
  const batches = chunk(pages, batchSize);
  const allCards = [];
  const errors = [];

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const batchFile = path.join(outputDir, `batch-${String(index + 1).padStart(3, "0")}.json`);
    console.log(`Gemini batch ${index + 1}/${batches.length}: pages ${batch.map((page) => page.page).join(", ")}`);
    try {
      let result;
      if (process.env.FORCE_REGENERATE !== "true") {
        try {
          result = JSON.parse(await fs.readFile(batchFile, "utf8"));
        } catch {
          result = null;
        }
      }
      if (!result) {
        result = await callGemini(model, batch);
        await fs.writeFile(batchFile, JSON.stringify(result, null, 2), "utf8");
        if (rateDelayMs > 0) await sleep(rateDelayMs);
      }
      const cards = Array.isArray(result.cards) ? result.cards : [];
      allCards.push(...cards);
      const normalized = await writeCurrentOutputs({ allCards, errors, model, pages, pageMap });
      console.log(`Current card count: ${normalized.length}`);
    } catch (error) {
      errors.push({ batch: index + 1, pages: batch.map((page) => page.page), message: error.message });
      console.error(error.message);
      await writeCurrentOutputs({ allCards, errors, model, pages, pageMap });
    }
  }

  const normalized = await writeCurrentOutputs({ allCards, errors, model, pages, pageMap });
  console.log(`Wrote ${normalized.length} cards to ${cardsPath}`);
}

await main();
