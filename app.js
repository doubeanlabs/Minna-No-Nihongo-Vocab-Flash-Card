const DEFAULT_CSV = "minna_no_nihongo_vocab.csv";
const STORAGE_KEY = "jp-vocab-cards:v1";
const DEFAULT_SETTINGS = { selectedChapter: "", filter: "all", size: 45 };

const els = {
  chapterList: document.querySelector("#chapterList"),
  chapterSelect: document.querySelector("#chapterSelect"),
  chapterTotal: document.querySelector("#chapterTotal"),
  chapterTitle: document.querySelector("#chapterTitle"),
  chapterStats: document.querySelector("#chapterStats"),
  cardGrid: document.querySelector("#cardGrid"),
  csvInput: document.querySelector("#csvInput"),
  stateInput: document.querySelector("#stateInput"),
  exportButton: document.querySelector("#exportButton"),
  resetProgressButton: document.querySelector("#resetProgressButton"),
  resetVocabularyButton: document.querySelector("#resetVocabularyButton"),
  sizeSlider: document.querySelector("#sizeSlider"),
  filterButtons: [...document.querySelectorAll("[data-filter]")],
  messageArea: document.querySelector("#messageArea"),
  importDialog: document.querySelector("#importDialog"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogSummary: document.querySelector("#dialogSummary"),
  dialogWarnings: document.querySelector("#dialogWarnings"),
  confirmImportButton: document.querySelector("#confirmImportButton"),
  cancelImportButton: document.querySelector("#cancelImportButton"),
  startQuizButton: document.querySelector("#startQuizButton"),
  bottomQuizButton: document.querySelector("#bottomQuizButton"),
  quizDialog: document.querySelector("#quizDialog"),
  quizProgress: document.querySelector("#quizProgress"),
  quizTitle: document.querySelector("#quizTitle"),
  quizBody: document.querySelector("#quizBody"),
  closeQuizButton: document.querySelector("#closeQuizButton"),
};

let state = {
  words: [],
  progress: {},
  settings: { ...DEFAULT_SETTINGS },
};

let pendingImport = null;
let quiz = null;

init();

async function init() {
  registerServiceWorker();
  applySavedState();
  applySize(state.settings.size);
  bindEvents();

  try {
    const defaultWords = await loadDefaultVocabulary();
    state.words = mergeDefaultWithSaved(defaultWords, state.words);
    if (!state.settings.selectedChapter || !getChapters().includes(state.settings.selectedChapter)) {
      state.settings.selectedChapter = getChapters()[0] || "";
    }
    saveState();
    render();
  } catch (error) {
    showMessage("I could not load the built-in vocabulary file. Check that the CSV is in the same GitHub project as the app.");
    console.error(error);
  }
}

function bindEvents() {
  els.chapterSelect.addEventListener("change", () => {
    state.settings.selectedChapter = els.chapterSelect.value;
    saveState();
    render();
  });

  els.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.settings.filter = button.dataset.filter;
      saveState();
      render();
    });
  });

  els.sizeSlider.addEventListener("input", () => {
    state.settings.size = Number(els.sizeSlider.value);
    applySize(state.settings.size);
    saveState();
  });

  els.csvInput.addEventListener("change", handleCsvUpload);
  els.stateInput.addEventListener("change", handleStateImport);
  els.exportButton.addEventListener("click", exportState);
  els.resetProgressButton.addEventListener("click", resetProgress);
  els.resetVocabularyButton.addEventListener("click", resetVocabulary);
  els.confirmImportButton.addEventListener("click", confirmPendingImport);
  els.cancelImportButton.addEventListener("click", closeImportDialog);
  els.startQuizButton.addEventListener("click", startQuiz);
  els.bottomQuizButton.addEventListener("click", startQuiz);
  els.closeQuizButton.addEventListener("click", closeQuiz);
}

function applySavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state = {
      words: Array.isArray(saved.words) ? saved.words : [],
      progress: saved.progress && typeof saved.progress === "object" ? saved.progress : {},
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
    };
  } catch {
    state = { words: [], progress: {}, settings: { ...DEFAULT_SETTINGS } };
  }
}

async function loadDefaultVocabulary() {
  const response = await fetch(DEFAULT_CSV, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Vocabulary load failed: ${response.status}`);
  const text = await response.text();
  const { words, warnings } = parseVocabularyCsv(text, []);
  if (warnings.length) {
    console.warn("Default vocabulary warnings", warnings);
  }
  return words;
}

function parseCsvRows(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    const next = clean[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function parseVocabularyCsv(text, existingWords = state.words) {
  const rows = parseCsvRows(text);
  const warnings = [];
  const words = [];
  const existingMap = new Map(existingWords.map((word) => [wordKey(word), word]));
  const seen = new Map();

  if (!rows.length) {
    return { words, warnings: [{ type: "file", message: "The CSV file is empty." }] };
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const index = {
    chapter: headers.indexOf("chapter"),
    hiragana: headers.indexOf("hiragana"),
    kanji: headers.indexOf("kanji"),
    english: headers.indexOf("english"),
  };

  for (const required of ["chapter", "hiragana", "english"]) {
    if (index[required] === -1) {
      warnings.push({ type: "file", message: `Missing required column: ${required}.` });
    }
  }

  if (warnings.length) return { words, warnings };

  rows.slice(1).forEach((row) => {
    const word = {
      chapter: valueAt(row, index.chapter),
      hiragana: valueAt(row, index.hiragana),
      kanji: index.kanji >= 0 ? valueAt(row, index.kanji) : "",
      english: valueAt(row, index.english),
    };

    const missing = [];
    if (!word.chapter) missing.push("chapter");
    if (!word.hiragana) missing.push("hiragana");
    if (!word.english) missing.push("english");
    if (missing.length) {
      warnings.push({
        type: "word",
        chapter: word.chapter,
        hiragana: word.hiragana,
        message: `Missing ${missing.join(", ")}.`,
      });
      return;
    }

    const key = wordKey(word);
    const duplicate = seen.get(key) || existingMap.get(key);
    if (duplicate && (duplicate.kanji !== word.kanji || duplicate.english !== word.english)) {
      warnings.push({
        type: "word",
        chapter: word.chapter,
        hiragana: word.hiragana,
        message: `Duplicate ${word.chapter} + ${word.hiragana} has different kanji or English meaning.`,
      });
    }

    seen.set(key, word);
    words.push(word);
  });

  return { words, warnings };
}

function valueAt(row, index) {
  return (row[index] || "").trim();
}

function wordKey(word) {
  return `${word.chapter}::${word.hiragana}`;
}

function mergeWords(baseWords, incomingWords) {
  const map = new Map();
  const order = [];
  for (const word of baseWords) {
    const key = wordKey(word);
    if (!map.has(key)) order.push(key);
    map.set(key, word);
  }
  for (const word of incomingWords) {
    const key = wordKey(word);
    if (!map.has(key)) order.push(key);
    map.set(key, word);
  }
  return { words: order.map((key) => map.get(key)) };
}

function mergeDefaultWithSaved(defaultWords, savedWords) {
  const defaultKeys = new Set(defaultWords.map((word) => wordKey(word)));
  const savedOnly = savedWords.filter((word) => !defaultKeys.has(wordKey(word)));
  return [...defaultWords, ...savedOnly];
}

function getChapters() {
  const chapters = [];
  const seen = new Set();
  for (const word of state.words) {
    if (!seen.has(word.chapter)) {
      seen.add(word.chapter);
      chapters.push(word.chapter);
    }
  }
  return chapters;
}

function render() {
  renderChapters();
  renderFilters();
  renderCards();
}

function renderChapters() {
  const chapters = getChapters();
  els.chapterTotal.textContent = chapters.length;

  els.chapterList.innerHTML = "";
  els.chapterSelect.innerHTML = "";
  for (const chapter of chapters) {
    const button = document.createElement("button");
    button.className = `chapter-button ${chapter === state.settings.selectedChapter ? "active" : ""}`;
    button.type = "button";
    button.textContent = chapterLabel(chapter);
    button.addEventListener("click", () => {
      state.settings.selectedChapter = chapter;
      saveState();
      render();
    });
    els.chapterList.appendChild(button);

    const option = document.createElement("option");
    option.value = chapter;
    option.textContent = chapterLabel(chapter);
    option.selected = chapter === state.settings.selectedChapter;
    els.chapterSelect.appendChild(option);
  }
}

function renderFilters() {
  els.filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.settings.filter);
  });
  els.sizeSlider.value = state.settings.size;
}

function renderCards() {
  const chapter = state.settings.selectedChapter;
  const allChapterWords = state.words.filter((word) => word.chapter === chapter);
  const words = allChapterWords.filter((word) => {
    const mastered = Boolean(state.progress[wordKey(word)]);
    if (state.settings.filter === "mastered") return mastered;
    if (state.settings.filter === "unmastered") return !mastered;
    return true;
  });
  const masteredCount = allChapterWords.filter((word) => state.progress[wordKey(word)]).length;

  els.chapterTitle.textContent = chapter ? chapterLabel(chapter) : "No vocabulary yet";
  els.chapterStats.textContent = chapter
    ? `${words.length} shown out of ${allChapterWords.length} words. ${masteredCount} mastered.`
    : "Upload or add a vocabulary CSV to begin.";
  els.startQuizButton.disabled = allChapterWords.length === 0;
  els.bottomQuizButton.disabled = allChapterWords.length === 0;

  els.cardGrid.innerHTML = "";
  if (!words.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = allChapterWords.length ? "No cards match this filter." : "No vocabulary in this chapter yet.";
    els.cardGrid.appendChild(empty);
    return;
  }

  for (const word of words) {
    els.cardGrid.appendChild(createCard(word));
  }
}

function createCard(word) {
  const key = wordKey(word);
  const card = document.createElement("article");
  card.className = `vocab-card ${state.progress[key] ? "mastered" : ""}`;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${word.hiragana}. Tap to flip.`);
  card.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-front">
        <div class="kana"></div>
        <div></div>
        <div class="kanji"></div>
      </div>
      <div class="card-face card-back">
        <div class="meaning"></div>
      </div>
    </div>
    <label class="card-checkbox" aria-label="Mark as mastered">
      <input type="checkbox" ${state.progress[key] ? "checked" : ""} />
    </label>
  `;
  card.querySelector(".kana").textContent = word.hiragana;
  card.querySelector(".kanji").textContent = word.kanji;
  card.querySelector(".meaning").textContent = word.english;

  card.addEventListener("click", (event) => {
    if (event.target.closest(".card-checkbox")) return;
    card.classList.toggle("flipped");
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.classList.toggle("flipped");
    }
  });
  card.querySelector("input").addEventListener("change", (event) => {
    state.progress[key] = event.target.checked;
    if (!event.target.checked) delete state.progress[key];
    saveState();
    card.classList.toggle("mastered", event.target.checked);
    renderCards();
  });
  return card;
}

function chapterLabel(chapter) {
  const text = String(chapter);
  return text.toLowerCase().startsWith("chapter") ? text : `Chapter ${text}`;
}

async function handleCsvUpload(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const text = await file.text();
  const result = parseVocabularyCsv(text);
  pendingImport = {
    type: "csv",
    words: result.words,
    warnings: result.warnings,
    sourceName: file.name,
  };
  showImportReview();
}

function showImportReview() {
  const validCount = pendingImport.words.length;
  const warningCount = pendingImport.warnings.length;
  els.dialogTitle.textContent = pendingImport.type === "csv" ? "CSV import review" : "Save import review";
  els.dialogSummary.textContent = `${pendingImport.sourceName}: ${validCount} valid row${validCount === 1 ? "" : "s"}, ${warningCount} warning${warningCount === 1 ? "" : "s"}.`;
  els.dialogWarnings.innerHTML = "";
  if (!warningCount) {
    const item = document.createElement("div");
    item.className = "warning-item";
    item.textContent = "No issues found. Ready to import.";
    els.dialogWarnings.appendChild(item);
  } else {
    for (const warning of pendingImport.warnings.slice(0, 80)) {
      const item = document.createElement("div");
      item.className = "warning-item";
      item.textContent = formatImportWarning(warning);
      els.dialogWarnings.appendChild(item);
    }
    if (pendingImport.warnings.length > 80) {
      const item = document.createElement("div");
      item.className = "warning-item";
      item.textContent = `Showing first 80 warnings out of ${pendingImport.warnings.length}.`;
      els.dialogWarnings.appendChild(item);
    }
  }
  els.confirmImportButton.disabled = !validCount;
  els.importDialog.showModal();
}

function formatImportWarning(warning) {
  if (warning.type === "file") return `File issue: ${warning.message}`;
  const chapter = warning.chapter || "unknown";
  const word = warning.hiragana || "unknown";
  return `Chapter ${chapter}, word ${word}: ${warning.message}`;
}

function confirmPendingImport() {
  if (!pendingImport) return;
  if (pendingImport.type === "state") {
    state = pendingImport.nextState;
  } else {
    state.words = mergeWords(state.words, pendingImport.words).words;
  }
  if (!state.settings.selectedChapter || !getChapters().includes(state.settings.selectedChapter)) {
    state.settings.selectedChapter = getChapters()[0] || "";
  }
  saveState();
  render();
  closeImportDialog();
  showMessage("Import complete. Your local copy has been updated.");
}

function closeImportDialog() {
  pendingImport = null;
  els.importDialog.close();
}

function exportState() {
  const payload = {
    app: "Japanese Vocabulary Cards",
    version: 1,
    exportedAt: new Date().toISOString(),
    words: state.words,
    progress: state.progress,
    settings: state.settings,
  };
  downloadFile(
    `japanese-vocab-save-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
}

async function handleStateImport(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.words)) throw new Error("Missing words list.");
    const nextState = {
      words: payload.words.filter((word) => word.chapter && word.hiragana && word.english),
      progress: payload.progress && typeof payload.progress === "object" ? payload.progress : {},
      settings: { ...DEFAULT_SETTINGS, ...(payload.settings || {}) },
    };
    pendingImport = {
      type: "state",
      nextState,
      words: nextState.words,
      warnings: [],
      sourceName: file.name,
    };
    showImportReview();
  } catch (error) {
    showMessage("That save file could not be imported. Please choose a JSON export from this app.");
    console.error(error);
  }
}

function resetProgress() {
  const ok = window.confirm("Reset all mastered checkboxes on this device? Vocabulary will stay.");
  if (!ok) return;
  state.progress = {};
  saveState();
  render();
  showMessage("Progress reset. Vocabulary is still here.");
}

async function resetVocabulary() {
  const ok = window.confirm("Reset vocabulary on this device to the built-in GitHub list? This removes words added through Upload CSV, but keeps progress for matching built-in words.");
  if (!ok) return;

  try {
    const defaultWords = await loadDefaultVocabulary();
    const defaultKeys = new Set(defaultWords.map((word) => wordKey(word)));
    state.words = defaultWords;
    state.progress = Object.fromEntries(
      Object.entries(state.progress).filter(([key]) => defaultKeys.has(key)),
    );
    if (!state.settings.selectedChapter || !getChapters().includes(state.settings.selectedChapter)) {
      state.settings.selectedChapter = getChapters()[0] || "";
    }
    saveState();
    render();
    showMessage("Vocabulary reset to the built-in GitHub list.");
  } catch (error) {
    showMessage("I could not reload the built-in vocabulary. Please refresh the page and try again.");
    console.error(error);
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showMessage(message) {
  els.messageArea.textContent = message;
  els.messageArea.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => {
    els.messageArea.hidden = true;
  }, 4500);
}

function applySize(value) {
  const ratio = Number(value) / 100;
  const width = 230 + ratio * 510;
  const height = 140 + ratio * 230;
  const kana = 22 + ratio * 34;
  const kanji = 15 + ratio * 21;
  document.documentElement.style.setProperty("--card-width", `${width}px`);
  document.documentElement.style.setProperty("--card-height", `${height}px`);
  document.documentElement.style.setProperty("--kana-size", `${kana}px`);
  document.documentElement.style.setProperty("--kanji-size", `${kanji}px`);
}

function startQuiz() {
  const chapterWords = state.words.filter((word) => word.chapter === state.settings.selectedChapter);
  if (!chapterWords.length) return;
  const questions = buildQuizQuestions(chapterWords);
  quiz = {
    chapter: state.settings.selectedChapter,
    questions,
    index: 0,
    score: 0,
    answered: false,
  };
  els.quizTitle.textContent = `${chapterLabel(quiz.chapter)} Quiz`;
  els.quizDialog.showModal();
  renderQuiz();
}

function buildQuizQuestions(words) {
  return shuffle(words).map((word) => {
    const types = ["kana-english", "english-kana"];
    if (word.kanji) types.push("kana-kanji");
    const type = sample(types);
    const question = makeQuestion(word, type, words);
    return question;
  });
}

function makeQuestion(word, type, words) {
  const optionPool = state.words.length > words.length ? state.words : words;
  if (type === "english-kana") {
    return {
      promptLabel: "Choose the kana",
      prompt: word.english,
      answer: word.hiragana,
      options: makeOptions(word.hiragana, optionPool.map((item) => item.hiragana)),
    };
  }
  if (type === "kana-kanji") {
    return {
      promptLabel: "Choose the kanji",
      prompt: word.hiragana,
      answer: word.kanji,
      options: makeOptions(word.kanji, optionPool.map((item) => item.kanji).filter(Boolean)),
    };
  }
  return {
    promptLabel: "Choose the meaning",
    prompt: word.hiragana,
    answer: word.english,
    options: makeOptions(word.english, optionPool.map((item) => item.english)),
  };
}

function makeOptions(answer, pool) {
  const unique = [...new Set(pool.filter((item) => item && item !== answer))];
  return shuffle([answer, ...shuffle(unique).slice(0, 3)]).slice(0, 4);
}

function renderQuiz() {
  const question = quiz.questions[quiz.index];
  els.quizProgress.textContent = `Question ${quiz.index + 1} of ${quiz.questions.length}`;
  els.quizBody.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="quiz-card ${quiz.answered ? "revealed" : ""}">
      <div class="quiz-card-inner">
        <div class="quiz-face">
          <div>
            <p class="eyebrow">${question.promptLabel}</p>
            <div class="quiz-prompt"></div>
          </div>
        </div>
        <div class="quiz-face quiz-answer">
          <div>
            <p class="eyebrow">Answer</p>
            <div class="quiz-prompt"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="quiz-options"></div>
    <div class="quiz-actions"></div>
  `;
  wrapper.querySelector(".quiz-face .quiz-prompt").textContent = question.prompt;
  wrapper.querySelector(".quiz-answer .quiz-prompt").textContent = question.answer;

  const options = wrapper.querySelector(".quiz-options");
  for (const option of question.options) {
    const button = document.createElement("button");
    button.className = "quiz-option";
    button.type = "button";
    button.textContent = option;
    button.disabled = quiz.answered;
    button.addEventListener("click", () => answerQuiz(option, button));
    options.appendChild(button);
  }

  const actions = wrapper.querySelector(".quiz-actions");
  if (quiz.answered) {
    const next = document.createElement("button");
    next.className = "primary-button";
    next.type = "button";
    next.textContent = quiz.index === quiz.questions.length - 1 ? "See Result" : "Next Question";
    next.addEventListener("click", nextQuiz);
    actions.appendChild(next);
  }

  els.quizBody.appendChild(wrapper);
}

function answerQuiz(option, button) {
  if (quiz.answered) return;
  const question = quiz.questions[quiz.index];
  quiz.answered = true;
  if (option === question.answer) {
    quiz.score += 1;
    button.classList.add("correct");
  } else {
    button.classList.add("wrong");
  }
  [...document.querySelectorAll(".quiz-option")].forEach((optionButton) => {
    optionButton.disabled = true;
    if (optionButton.textContent === question.answer) optionButton.classList.add("correct");
  });
  document.querySelector(".quiz-card").classList.add("revealed");

  const actions = document.querySelector(".quiz-actions");
  const next = document.createElement("button");
  next.className = "primary-button";
  next.type = "button";
  next.textContent = quiz.index === quiz.questions.length - 1 ? "See Result" : "Next Question";
  next.addEventListener("click", nextQuiz);
  actions.appendChild(next);
}

function nextQuiz() {
  if (quiz.index === quiz.questions.length - 1) {
    showQuizResult();
    return;
  }
  quiz.index += 1;
  quiz.answered = false;
  renderQuiz();
}

function showQuizResult() {
  els.quizProgress.textContent = "Quiz complete";
  els.quizBody.innerHTML = `
    <div class="quiz-result">
      <p class="eyebrow">Result</p>
      <h2>${quiz.score} / ${quiz.questions.length}</h2>
      <p class="muted">Quiz scores are for review only and do not change your mastered checkboxes.</p>
      <div class="quiz-actions">
        <button id="retryQuiz" class="primary-button" type="button">Try Again</button>
        <button id="finishQuiz" class="tool-button subtle" type="button">Done</button>
      </div>
    </div>
  `;
  document.querySelector("#retryQuiz").addEventListener("click", startQuiz);
  document.querySelector("#finishQuiz").addEventListener("click", closeQuiz);
}

function closeQuiz() {
  quiz = null;
  els.quizDialog.close();
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}
