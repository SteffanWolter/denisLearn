# denisLearn Plan

## Ziel

Aus `AUT_SS26_redux.pdf` automatisch pruefungsrelevante Anki-Karten erzeugen und eine Android-taugliche PWA bauen, die auf GitHub Pages statisch laeuft.

## Pipeline

1. PDF-Seiten in Batches von 5 Seiten verarbeiten.
2. Jede Seite als Bild rendern und an Gemini senden.
3. Gemini Structured Output erzwingen:
   - `question`
   - `answer`
   - `category`
   - `examRelevance`
   - `sourcePages`
   - `highlights`
   - `importantGraphic`
   - `graphicPages`
4. Prompt verlangt:
   - pruefungsrelevante Fragen
   - voll ausformulierte Antworten
   - gute Markierungen und Begriffe
   - keine trivialen Karten
   - Inhalte so erklaeren, dass man damit lernen kann
5. Falls `importantGraphic=true`, wird die jeweilige PDF-Seite als WebP in `public/media/` abgelegt und bei passenden Karten referenziert.
6. Ausgabe:
   - `public/data/cards.json`
   - `pipeline/output/cards.raw.json`
   - `pipeline/output/pipeline-report.json`

## PWA

1. Startmenue mit Lernstart, Kategorien, Sessiongroesse.
2. Session-Modus:
   - Frage anzeigen
   - Antwort aufdecken
   - "Richtig" oder "Wiederholen" bestaetigen
   - nach 3 richtigen Bestaetigungen gilt eine Karte als gelernt
3. Gelernte Karten erscheinen nicht mehr in normalen Sessions.
4. Dashboard:
   - Fortschritt
   - Kategorien
   - offene Karten
   - gelernte Karten
5. Fragenansicht:
   - alle Karten durchsuchen
   - nach Kategorie filtern
   - Quellseiten und Grafiken anzeigen
6. Einstellungen:
   - Lernstand resetten
   - einzelne Karten wieder aktivieren
   - Local Storage komplett zuruecksetzen

## GitHub Pages

1. Next.js statisch exportieren mit `output: "export"`.
2. GitHub Actions Workflow baut `out/` und deployed Pages.
3. Fuer Repo-Unterpfade kann `NEXT_PUBLIC_BASE_PATH=/repo-name` gesetzt werden.
4. `GEMINI_API_KEY` bleibt lokal und wird nicht committed.

## Befehle

```bash
npm install
npm run make:icons
npm run pipeline
npm run build
```

Optional lokal testen:

```bash
npm run dev
```
