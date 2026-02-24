(function () {
  "use strict";

  /**
   * Expected puzzle JSON format:
   * {
   *   "title": "Sample",
   *   "rows": 5,
   *   "cols": 5,
   *   "grid": [
   *     [ { "row":0,"col":0,"solution":"H","isBlock":false,"number":1 }, ... ],
   *     ...
   *   ],
   *   "clues": {
   *     "across": [ { "number":1,"text":"Clue","cells":[{"row":0,"col":0},...] }, ... ],
   *     "down":   [ { "number":1,"text":"Clue","cells":[{"row":0,"col":0},...] }, ... ]
   *   }
   * }
   */

  const gridEl = document.getElementById("cw-grid");
  const titleEl = document.getElementById("cw-title");
  const cluesAcrossEl = document.getElementById("cw-clues-across");
  const cluesDownEl = document.getElementById("cw-clues-down");
  const statusEl = document.getElementById("cw-status");

  const btnCheck = document.getElementById("btn-check");
  const btnRevealLetter = document.getElementById("btn-reveal-letter");
  const btnRevealWord = document.getElementById("btn-reveal-word");
  const btnClear = document.getElementById("btn-clear");

  let puzzle = null;
  let cellMap = new Map(); // key "r,c" -> { input, meta }
  let currentDirection = "across"; // "across" | "down"
  let currentCellKey = null; // "r,c"

  function showStatus(message, kind) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.remove("cw-status--ok", "cw-status--error");
    if (kind === "ok") statusEl.classList.add("cw-status--ok");
    if (kind === "error") statusEl.classList.add("cw-status--error");
  }

  function keyFor(row, col) {
    return row + "," + col;
  }

  function getCell(row, col) {
    return cellMap.get(keyFor(row, col));
  }

  function parseQuery() {
    const params = new URLSearchParams(window.location.search);
    return {
      puzzle: params.get("puzzle") || "oscars-crossword",
    };
  }

  async function loadPuzzle() {
    const { puzzle } = parseQuery();
    const url = "puzzles/" + encodeURIComponent(puzzle) + ".json";

    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) {
        throw new Error("Failed to load puzzle: " + res.status);
      }
      const data = await res.json();
      initPuzzle(data);
      showStatus("Loaded puzzle \"" + (data.title || puzzle) + "\"", "ok");
    } catch (err) {
      console.error(err);
      showStatus("Could not load puzzle \"" + puzzle + "\".", "error");
    }
  }

  function initPuzzle(data) {
    puzzle = data;
    cellMap.clear();
    gridEl.innerHTML = "";
    cluesAcrossEl.innerHTML = "";
    cluesDownEl.innerHTML = "";
    currentCellKey = null;

    if (titleEl) {
      titleEl.textContent = data.title || "Crossword";
    }

    // Build grid
    gridEl.style.gridTemplateColumns = `repeat(${data.cols}, var(--cell-size))`;

    for (let r = 0; r < data.rows; r++) {
      for (let c = 0; c < data.cols; c++) {
        const cellData = data.grid[r][c];
        const cellDiv = document.createElement("div");
        cellDiv.className = "cw-cell";

        if (cellData.isBlock) {
          cellDiv.classList.add("cw-cell-black");
          gridEl.appendChild(cellDiv);
          continue;
        }

        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 1;
        input.inputMode = "text";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.className = "cw-cell-input";

        const numberSpan = document.createElement("span");
        numberSpan.className = "cw-cell-number";
        if (cellData.number != null) {
          numberSpan.textContent = String(cellData.number);
        }

        cellDiv.appendChild(input);
        cellDiv.appendChild(numberSpan);
        gridEl.appendChild(cellDiv);

        const meta = {
          row: r,
          col: c,
          solution: (cellData.solution || "").toUpperCase(),
          input,
          div: cellDiv,
        };

        const k = keyFor(r, c);
        cellMap.set(k, meta);

        input.addEventListener("focus", () => {
          currentCellKey = k;
          updateHighlights();
        });

        input.addEventListener("click", () => {
          currentCellKey = k;
          updateHighlights();
        });

        input.addEventListener("keydown", (e) => handleKeyDown(e, meta));
        input.addEventListener("input", (e) => handleInput(e, meta));
      }
    }

    // Build clues
    function renderClueList(list, dest, direction) {
      for (const clue of list) {
        const li = document.createElement("li");
        li.className = "cw-clue";
        li.dataset.direction = direction;
        li.dataset.number = String(clue.number);

        const numSpan = document.createElement("span");
        numSpan.className = "cw-clue-number";
        numSpan.textContent = String(clue.number);

        const textSpan = document.createElement("span");
        textSpan.className = "cw-clue-text";
        textSpan.textContent = clue.text;

        li.appendChild(numSpan);
        li.appendChild(textSpan);

        li.addEventListener("click", () => {
          currentDirection = direction;
          focusFirstCellOfClue(clue);
          updateHighlights();
        });

        dest.appendChild(li);
      }
    }

    renderClueList(data.clues.across, cluesAcrossEl, "across");
    renderClueList(data.clues.down, cluesDownEl, "down");
  }

  function findClueForCell(row, col, direction) {
    const list = puzzle?.clues?.[direction];
    if (!list) return null;
    for (const clue of list) {
      if (clue.cells.some((p) => p.row === row && p.col === col)) {
        return clue;
      }
    }
    return null;
  }

  function focusFirstCellOfClue(clue) {
    if (!clue || !clue.cells || !clue.cells.length) return;
    const first = clue.cells[0];
    const cell = getCell(first.row, first.col);
    if (cell && cell.input) {
      currentCellKey = keyFor(first.row, first.col);
      cell.input.focus();
    }
  }

  function updateHighlights() {
    // Clear
    for (const meta of cellMap.values()) {
      meta.div.classList.remove(
        "cw-cell-active",
        "cw-cell-word-highlight",
        "cw-cell-correct",
        "cw-cell-incorrect"
      );
    }
    for (const el of document.querySelectorAll(".cw-clue")) {
      el.classList.remove("cw-clue--active");
    }

    if (!puzzle || !currentCellKey) return;
    const meta = cellMap.get(currentCellKey);
    if (!meta) return;

    // Toggle direction if the current cell doesn't belong to any word in that direction
    let clue = findClueForCell(meta.row, meta.col, currentDirection);
    if (!clue) {
      const other = currentDirection === "across" ? "down" : "across";
      const otherClue = findClueForCell(meta.row, meta.col, other);
      if (otherClue) {
        currentDirection = other;
        clue = otherClue;
      }
    }

    meta.div.classList.add("cw-cell-active");

    if (!clue) return;

    for (const pos of clue.cells) {
      const c = getCell(pos.row, pos.col);
      if (c) {
        c.div.classList.add("cw-cell-word-highlight");
      }
    }

    const selector =
      '.cw-clue[data-direction="' +
      currentDirection +
      '"][data-number="' +
      clue.number +
      '"]';
    const clueEl = document.querySelector(selector);
    if (clueEl) {
      clueEl.classList.add("cw-clue--active");
      clueEl.scrollIntoView({ block: "nearest" });
    }
  }

  function moveFocus(deltaRow, deltaCol) {
    if (!currentCellKey || !puzzle) return;
    const [row, col] = currentCellKey.split(",").map(Number);
    let r = row;
    let c = col;

    while (true) {
      r += deltaRow;
      c += deltaCol;
      if (r < 0 || c < 0 || r >= puzzle.rows || c >= puzzle.cols) {
        return;
      }
      const next = getCell(r, c);
      if (!next) continue;
      if (next.div.classList.contains("cw-cell-black")) continue;
      currentCellKey = keyFor(r, c);
      next.input.focus();
      break;
    }
  }

  function moveWithinWord(meta, step) {
    if (!puzzle) return;
    const clue = findClueForCell(meta.row, meta.col, currentDirection);
    if (!clue) {
      moveFocus(step, 0);
      return;
    }
    const idx = clue.cells.findIndex(
      (p) => p.row === meta.row && p.col === meta.col
    );
    if (idx === -1) return;

    const nextIndex = idx + step;
    if (nextIndex < 0 || nextIndex >= clue.cells.length) {
      // Optionally wrap within word; for now just stop
      return;
    }
    const target = clue.cells[nextIndex];
    const cell = getCell(target.row, target.col);
    if (cell && cell.input) {
      currentCellKey = keyFor(target.row, target.col);
      cell.input.focus();
    }
  }

  function handleKeyDown(e, meta) {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        currentDirection = "down";
        moveFocus(-1, 0);
        break;
      case "ArrowDown":
        e.preventDefault();
        currentDirection = "down";
        moveFocus(1, 0);
        break;
      case "ArrowLeft":
        e.preventDefault();
        currentDirection = "across";
        moveFocus(0, -1);
        break;
      case "ArrowRight":
        e.preventDefault();
        currentDirection = "across";
        moveFocus(0, 1);
        break;
      case "Backspace":
        if (!meta.input.value) {
          moveWithinWord(meta, -1);
        }
        break;
      case "Tab":
        // Let browser handle focus order
        break;
      default:
        break;
    }
  }

  function handleInput(e, meta) {
    const val = (e.target.value || "").toUpperCase().replace(/[^A-Z]/g, "");
    e.target.value = val;
    if (val && meta.solution) {
      moveWithinWord(meta, 1);
    }
    showStatus("", null);
  }

  function getAllFilled() {
    const filled = [];
    for (const meta of cellMap.values()) {
      const val = (meta.input.value || "").toUpperCase();
      filled.push({
        row: meta.row,
        col: meta.col,
        val,
        solution: meta.solution,
      });
    }
    return filled;
  }

  function cmdCheckAll() {
    const filled = getAllFilled();
    let anyIncorrect = false;
    let allFilled = true;

    for (const meta of cellMap.values()) {
      meta.div.classList.remove("cw-cell-correct", "cw-cell-incorrect");
    }

    for (const cell of filled) {
      const meta = getCell(cell.row, cell.col);
      if (!meta) continue;
      if (!cell.val) {
        allFilled = false;
        continue;
      }
      if (cell.val === cell.solution) {
        meta.div.classList.add("cw-cell-correct");
      } else {
        anyIncorrect = true;
        meta.div.classList.add("cw-cell-incorrect");
      }
    }

    if (!allFilled) {
      showStatus("Some cells are still empty.", "error");
    } else if (anyIncorrect) {
      showStatus("There are some incorrect letters.", "error");
    } else {
      showStatus("Perfect! Puzzle completed.", "ok");
    }
  }

  function getCurrentClue() {
    if (!currentCellKey || !puzzle) return null;
    const [row, col] = currentCellKey.split(",").map(Number);
    return findClueForCell(row, col, currentDirection);
  }

  function cmdRevealLetter() {
    const clue = getCurrentClue();
    if (!clue) return;
    for (const pos of clue.cells) {
      const meta = getCell(pos.row, pos.col);
      if (!meta) continue;
      if (!meta.input.value || meta.input.value.toUpperCase() !== meta.solution) {
        meta.input.value = meta.solution;
        meta.div.classList.remove("cw-cell-incorrect");
        meta.div.classList.add("cw-cell-correct");
        currentCellKey = keyFor(pos.row, pos.col);
        meta.input.focus();
        showStatus("Revealed one letter.", "ok");
        return;
      }
    }
  }

  function cmdRevealWord() {
    const clue = getCurrentClue();
    if (!clue) return;
    for (const pos of clue.cells) {
      const meta = getCell(pos.row, pos.col);
      if (!meta) continue;
      meta.input.value = meta.solution;
      meta.div.classList.remove("cw-cell-incorrect");
      meta.div.classList.add("cw-cell-correct");
    }
    const first = clue.cells[0];
    const cell = getCell(first.row, first.col);
    if (cell) {
      currentCellKey = keyFor(first.row, first.col);
      cell.input.focus();
    }
    showStatus("Revealed the current word.", "ok");
  }

  function cmdClear() {
    for (const meta of cellMap.values()) {
      meta.input.value = "";
      meta.div.classList.remove(
        "cw-cell-correct",
        "cw-cell-incorrect",
        "cw-cell-active",
        "cw-cell-word-highlight"
      );
    }
    showStatus("Cleared all entries.", null);
  }

  btnCheck?.addEventListener("click", cmdCheckAll);
  btnRevealLetter?.addEventListener("click", cmdRevealLetter);
  btnRevealWord?.addEventListener("click", cmdRevealWord);
  btnClear?.addEventListener("click", cmdClear);

  window.addEventListener("DOMContentLoaded", loadPuzzle);
})();

