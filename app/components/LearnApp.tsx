"use client";

import {
  BookOpen,
  Check,
  ChevronRight,
  Home,
  ListFilter,
  RotateCcw,
  Search,
  Settings,
  Smartphone,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Card = {
  id: string;
  question: string;
  answer: string;
  category: string;
  examRelevance: "high" | "medium" | "low";
  sourcePages: number[];
  highlights: string[];
  importantGraphic?: boolean;
  media?: string[];
};

type CardProgress = {
  correctCount: number;
  attempts: number;
  lastSeenAt?: string;
  lastResult?: "correct" | "again";
};

type ProgressMap = Record<string, CardProgress>;
type View = "home" | "learn" | "cards" | "settings";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const STORAGE_KEY = "denisLearn.progress.v1";
const SESSION_KEY = "denisLearn.session.v1";
const INSTALL_PROMPT_KEY = "denisLearn.installPrompt.v1";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const fallbackCards: Card[] = [
  {
    id: "sample-1",
    question: "Pipeline noch nicht gelaufen: Was ist der naechste Schritt?",
    answer:
      "Fuehre `npm run pipeline` aus, damit aus der PDF echte pruefungsrelevante Karten erzeugt und in public/data/cards.json gespeichert werden.",
    category: "Setup",
    examRelevance: "high",
    sourcePages: [1],
    highlights: ["npm run pipeline", "cards.json"]
  }
];

function readProgress(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeProgress(progress: ProgressMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function learned(progress?: CardProgress) {
  return (progress?.correctCount || 0) >= 3;
}

function clampSessionSize(value: number, max: number) {
  if (!Number.isFinite(value)) return Math.min(20, max);
  return Math.max(1, Math.min(Math.floor(value), Math.max(1, max)));
}

function assetPath(path: string) {
  if (!path || path.startsWith("http")) return path;
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

export default function LearnApp() {
  const [cards, setCards] = useState<Card[]>(fallbackCards);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [view, setView] = useState<View>("home");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sessionSize, setSessionSize] = useState(20);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [query, setQuery] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  useEffect(() => {
    setProgress(readProgress());
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        if (Array.isArray(session.ids)) {
          setSessionIds(session.ids);
          setSessionIndex(session.index || 0);
        }
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }

    fetch(assetPath("/data/cards.json"), { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : fallbackCards))
      .then((data) => {
        const parsed = Array.isArray(data) ? data : data.cards;
        setCards(parsed?.length ? parsed : fallbackCards);
      })
      .catch(() => setCards(fallbackCards));

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(assetPath("/sw.js")).catch(() => undefined);
    }

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setShowInstallPrompt(!standalone && localStorage.getItem(INSTALL_PROMPT_KEY) !== "dismissed");

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      if (localStorage.getItem(INSTALL_PROMPT_KEY) !== "dismissed") setShowInstallPrompt(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ids: sessionIds, index: sessionIndex }));
  }, [sessionIds, sessionIndex]);

  const categories = useMemo(
    () => Array.from(new Set(cards.map((card) => card.category))).sort((a, b) => a.localeCompare(b)),
    [cards]
  );

  const categoryCounts = useMemo(() => {
    return categories.map((category) => {
      const inCategory = cards.filter((card) => card.category === category);
      const learnedCount = inCategory.filter((card) => learned(progress[card.id])).length;
      return { category, total: inCategory.length, learned: learnedCount };
    });
  }, [cards, categories, progress]);

  const openCards = useMemo(() => cards.filter((card) => !learned(progress[card.id])), [cards, progress]);
  const learnedCount = cards.length - openCards.length;
  const dueCards = useMemo(() => {
    const pool = selectedCategories.length
      ? openCards.filter((card) => selectedCategories.includes(card.category))
      : openCards;
    return pool.sort((a, b) => {
      const pa = progress[a.id]?.correctCount || 0;
      const pb = progress[b.id]?.correctCount || 0;
      if (pa !== pb) return pa - pb;
      return a.sourcePages[0] - b.sourcePages[0];
    });
  }, [openCards, progress, selectedCategories]);

  const activeCard = cards.find((card) => card.id === sessionIds[sessionIndex]);
  const progressPercent = cards.length ? Math.round((learnedCount / cards.length) * 100) : 0;

  function updateCard(id: string, result: "correct" | "again") {
    const current = progress[id] || { correctCount: 0, attempts: 0 };
    const next: CardProgress = {
      correctCount: result === "correct" ? Math.min(3, current.correctCount + 1) : current.correctCount,
      attempts: current.attempts + 1,
      lastSeenAt: new Date().toISOString(),
      lastResult: result
    };
    const nextProgress = { ...progress, [id]: next };
    setProgress(nextProgress);
    writeProgress(nextProgress);

    setShowAnswer(false);
    if (sessionIndex + 1 < sessionIds.length) {
      setSessionIndex((value) => value + 1);
    } else {
      setView("home");
      setSessionIds([]);
      setSessionIndex(0);
    }
  }

  function startSession() {
    const size = clampSessionSize(sessionSize, dueCards.length);
    const ids = dueCards.slice(0, size).map((card) => card.id);
    setSessionIds(ids);
    setSessionIndex(0);
    setShowAnswer(false);
    setView("learn");
  }

  function resetProgress(cardId?: string) {
    const next = { ...progress };
    if (cardId) delete next[cardId];
    else Object.keys(next).forEach((key) => delete next[key]);
    setProgress(next);
    writeProgress(next);
  }

  function fullReset() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SESSION_KEY);
    setProgress({});
    setSessionIds([]);
    setSessionIndex(0);
    setShowAnswer(false);
    setView("home");
  }

  function dismissInstallPrompt() {
    localStorage.setItem(INSTALL_PROMPT_KEY, "dismissed");
    setShowInstallPrompt(false);
  }

  async function installApp() {
    if (!installPrompt) {
      dismissInstallPrompt();
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") dismissInstallPrompt();
    setInstallPrompt(null);
  }

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      const matchesCategory = cardFilter === "all" || card.category === cardFilter;
      const needle = query.trim().toLowerCase();
      const matchesQuery =
        !needle ||
        card.question.toLowerCase().includes(needle) ||
        card.answer.toLowerCase().includes(needle) ||
        card.highlights.join(" ").toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [cards, cardFilter, query]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">dL</div>
          <div>
            <h1>denisLearn</h1>
            <p>PDF-Karten, mobil lernbar</p>
          </div>
        </div>
        <div className="sync-state">
          <Check size={17} />
          Local Storage aktiv
        </div>
      </header>

      <main className="main">
        {showInstallPrompt && (
          <section className="install-banner" aria-label="App installieren">
            <div className="install-banner-copy">
              <Smartphone size={22} aria-hidden="true" />
              <div>
                <strong>Als App installieren</strong>
                <p>Fuer schnelles Lernen auf Android: zum Startbildschirm hinzufuegen und Fortschritt lokal behalten.</p>
              </div>
            </div>
            <div className="install-banner-actions">
              <button className="btn secondary compact" onClick={dismissInstallPrompt}>
                Spaeter
              </button>
              <button className="btn compact" onClick={installApp}>
                Installieren
              </button>
            </div>
          </section>
        )}

        {view === "home" && (
          <section className="section">
            <div className="overview">
              <div className="panel panel-pad">
                <div className="title-row">
                  <div>
                    <h2>Lernstart</h2>
                    <p>Waehle Kategorien und Sessiongroesse. Karten mit drei richtigen Bestaetigungen tauchen nicht mehr auf.</p>
                  </div>
                  <span className="pill">{progressPercent}% gelernt</span>
                </div>

                <div className="stats">
                  <div className="stat">
                    <strong>{cards.length}</strong>
                    <span>Karten</span>
                  </div>
                  <div className="stat">
                    <strong>{openCards.length}</strong>
                    <span>offen</span>
                  </div>
                  <div className="stat">
                    <strong>{learnedCount}</strong>
                    <span>gelernt</span>
                  </div>
                  <div className="stat">
                    <strong>{categories.length}</strong>
                    <span>Kategorien</span>
                  </div>
                </div>

                <div style={{ marginTop: 18 }} className="progress-track" aria-label="Lernfortschritt">
                  <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>

                <div className="form-grid">
                  <div className="field">
                    <label>Kategorien</label>
                    <div className="category-grid">
                      <button
                        className="chip"
                        data-active={selectedCategories.length === 0}
                        onClick={() => setSelectedCategories([])}
                      >
                        Alle
                      </button>
                      {categories.map((category) => (
                        <button
                          key={category}
                          className="chip"
                          data-active={selectedCategories.includes(category)}
                          onClick={() =>
                            setSelectedCategories((current) =>
                              current.includes(category)
                                ? current.filter((item) => item !== category)
                                : [...current, category]
                            )
                          }
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="session-size">Fragen in dieser Session</label>
                    <input
                      id="session-size"
                      className="input"
                      type="number"
                      min={1}
                      max={Math.max(1, dueCards.length)}
                      value={sessionSize}
                      onChange={(event) => setSessionSize(Number(event.target.value))}
                    />
                  </div>

                  <div className="btn-row">
                    <button className="btn" onClick={startSession} disabled={!dueCards.length}>
                      <BookOpen size={18} />
                      Lernen starten
                      <ChevronRight size={18} />
                    </button>
                    <button className="btn secondary" onClick={() => setView("cards")}>
                      <ListFilter size={18} />
                      Fragen ansehen
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel panel-pad">
                <h2>Kategorien</h2>
                <div className="category-table">
                  {categoryCounts.map((row) => (
                    <div className="category-row" key={row.category}>
                      <div>
                        <strong>{row.category}</strong>
                        <div className="muted">{row.learned} von {row.total} gelernt</div>
                      </div>
                      <span className="pill">{Math.round((row.learned / row.total) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {view === "learn" && (
          <section className="section">
            {!activeCard ? (
              <div className="panel empty">
                <div>
                  <h2>Keine offenen Karten</h2>
                  <p>Starte eine neue Session oder setze Lernstand in den Einstellungen zurueck.</p>
                </div>
              </div>
            ) : (
              <div className="panel panel-pad session-card">
                <div className="card-meta">
                  <span className="pill">{sessionIndex + 1} / {sessionIds.length}</span>
                  <span className="pill">{activeCard.category}</span>
                  <span className="pill">Seite {activeCard.sourcePages.join(", ")}</span>
                  <span className="pill">{progress[activeCard.id]?.correctCount || 0} / 3 richtig</span>
                </div>

                <div className="qa">
                  <p className="question">{activeCard.question}</p>
                  {showAnswer && (
                    <div className="answer">
                      <p>{activeCard.answer}</p>
                      {!!activeCard.highlights?.length && (
                        <div className="highlight-list">
                          {activeCard.highlights.map((item) => (
                            <span className="highlight" key={item}>{item}</span>
                          ))}
                        </div>
                      )}
                      {activeCard.media?.map((src) => (
                        <img className="media" src={assetPath(src)} alt={`Quelle ${activeCard.sourcePages.join(", ")}`} key={src} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="btn-row">
                  {!showAnswer ? (
                    <button className="btn" onClick={() => setShowAnswer(true)}>
                      Antwort zeigen
                    </button>
                  ) : (
                    <>
                      <button className="btn secondary" onClick={() => updateCard(activeCard.id, "again")}>
                        <X size={18} />
                        Wiederholen
                      </button>
                      <button className="btn" onClick={() => updateCard(activeCard.id, "correct")}>
                        <Check size={18} />
                        Richtig
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {view === "cards" && (
          <section className="section">
            <div className="panel panel-pad">
              <div className="title-row">
                <div>
                  <h2>Fragen</h2>
                  <p>Durchsuche alle generierten Karten und reaktiviere gelernte Karten einzeln.</p>
                </div>
                <span className="pill">{filteredCards.length} Treffer</span>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="search">Suche</label>
                  <div style={{ position: "relative" }}>
                    <Search size={18} style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }} />
                    <input
                      id="search"
                      className="input"
                      style={{ paddingLeft: 38 }}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Begriff, Frage oder Antwort"
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="card-filter">Kategorie</label>
                  <select id="card-filter" className="select" value={cardFilter} onChange={(event) => setCardFilter(event.target.value)}>
                    <option value="all">Alle Kategorien</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="card-grid">
              {filteredCards.map((card) => {
                const itemProgress = progress[card.id];
                return (
                  <article className="question-card" key={card.id}>
                    <div className="card-meta">
                      <span className="pill">{card.category}</span>
                      <span className="pill">{itemProgress?.correctCount || 0} / 3</span>
                      {learned(itemProgress) && <span className="pill">gelernt</span>}
                    </div>
                    <h3>{card.question}</h3>
                    <p>{card.answer}</p>
                    {!!card.highlights?.length && (
                      <div className="highlight-list">
                        {card.highlights.slice(0, 5).map((item) => (
                          <span className="highlight" key={item}>{item}</span>
                        ))}
                      </div>
                    )}
                    <div className="btn-row">
                      <button className="btn secondary" onClick={() => resetProgress(card.id)}>
                        <RotateCcw size={17} />
                        Reset
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {view === "settings" && (
          <section className="section">
            <div className="panel panel-pad">
              <div className="title-row">
                <div>
                  <h2>Einstellungen</h2>
                  <p>Setze Lernstand zurueck, falls du neu anfangen oder die Karten erneut trainieren willst.</p>
                </div>
              </div>
              <div className="stats">
                <div className="stat">
                  <strong>{Object.keys(progress).length}</strong>
                  <span>Karten mit Verlauf</span>
                </div>
                <div className="stat">
                  <strong>{learnedCount}</strong>
                  <span>ausgeblendet</span>
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 20 }}>
                <button className="btn secondary" onClick={() => resetProgress()}>
                  <RotateCcw size={18} />
                  Lernstand resetten
                </button>
                <button className="btn danger" onClick={fullReset}>
                  <X size={18} />
                  Local Storage leeren
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Navigation">
        <button className="nav-btn" data-active={view === "home"} onClick={() => setView("home")}>
          <Home size={21} />
          Start
        </button>
        <button className="nav-btn" data-active={view === "learn"} onClick={() => setView("learn")}>
          <BookOpen size={21} />
          Lernen
        </button>
        <button className="nav-btn" data-active={view === "cards"} onClick={() => setView("cards")}>
          <ListFilter size={21} />
          Fragen
        </button>
        <button className="nav-btn" data-active={view === "settings"} onClick={() => setView("settings")}>
          <Settings size={21} />
          Setup
        </button>
      </nav>
    </div>
  );
}
