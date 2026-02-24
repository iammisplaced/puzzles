const fs = require("fs");
const path = require("path");

const CSV_PATH = path.join(__dirname, "oscars.csv");
const OUT_PATH = path.join(__dirname, "puzzles", "oscars-crossword.json");

function readCsv() {
  const raw = fs.readFileSync(CSV_PATH, "utf8").trim();
  const lines = raw.split(/\r?\n/);
  const entries = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const idx = line.indexOf(",");
    if (idx === -1) continue;
    const answerRaw = line.slice(0, idx).trim();
    let clueRaw = line.slice(idx + 1).trim();

    // Strip outer quotes and collapse doubled quotes
    if (clueRaw.startsWith('"') && clueRaw.endsWith('"')) {
      clueRaw = clueRaw.slice(1, -1);
    }
    clueRaw = clueRaw.replace(/""/g, '"');

    const answerNorm = answerRaw.toUpperCase().replace(/[^A-Z]/g, "");
    if (!answerNorm) continue;

    entries.push({
      answer: answerNorm,
      clue: clueRaw,
      rawAnswer: answerRaw,
    });
  }
  return entries;
}

function key(r, c) {
  return r + "," + c;
}

function buildGrid(entries) {
  const grid = new Map(); // "r,c" -> letter
  const placed = []; // { index, row, col, dir, answer }
  let minRow = 0,
    maxRow = 0,
    minCol = 0,
    maxCol = 0;

  function has(r, c) {
    return grid.has(key(r, c));
  }

  function get(r, c) {
    return grid.get(key(r, c));
  }

  function canPlace(answer, row, col, dir) {
    const len = answer.length;

    // Start/end must be bounded by empty space
    if (dir === "across") {
      if (has(row, col - 1)) return null;
      if (has(row, col + len)) return null;
    } else {
      if (has(row - 1, col)) return null;
      if (has(row + len, col)) return null;
    }

    let intersections = 0;
    let newMinRow = minRow;
    let newMaxRow = maxRow;
    let newMinCol = minCol;
    let newMaxCol = maxCol;

    for (let i = 0; i < len; i++) {
      const r = dir === "across" ? row : row + i;
      const c = dir === "across" ? col + i : col;
      const existing = get(r, c);
      const ch = answer[i];

      if (existing) {
        if (existing !== ch) return null;
        intersections++;
      } else {
        // No side-by-side touching that would create unintended perpendicular words
        if (dir === "across") {
          if (has(r - 1, c) || has(r + 1, c)) return null;
        } else {
          if (has(r, c - 1) || has(r, c + 1)) return null;
        }
      }

      if (r < newMinRow) newMinRow = r;
      if (r > newMaxRow) newMaxRow = r;
      if (c < newMinCol) newMinCol = c;
      if (c > newMaxCol) newMaxCol = c;
    }

    // Require at least one crossing when attaching to existing grid
    if (grid.size > 0 && intersections === 0) return null;

    const height = newMaxRow - newMinRow + 1;
    const width = newMaxCol - newMinCol + 1;
    const area = height * width;
    const aspectPenalty = Math.abs(width - height);

    // Favor more crossings and compact shape
    const score = intersections * 1000 - area - aspectPenalty * 5;

    return {
      intersections,
      score,
      bounds: { newMinRow, newMaxRow, newMinCol, newMaxCol },
    };
  }

  function placeWordAt(index, answer, row, col, dir) {
    const ok = canPlace(answer, row, col, dir) || (grid.size === 0 ? { bounds: { newMinRow: row, newMaxRow: row, newMinCol: col, newMaxCol: col } } : null);
    if (!ok && grid.size > 0) {
      throw new Error("Invalid placement attempted for " + answer);
    }

    for (let i = 0; i < answer.length; i++) {
      const r = dir === "across" ? row : row + i;
      const c = dir === "across" ? col + i : col;
      const k = key(r, c);
      const ch = answer[i];
      grid.set(k, ch);
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
    }

    placed.push({ index, row, col, dir, answer });
  }

  function bestPlacement(answer) {
    let best = null;

    // Collect existing letter cells
    const existingCells = Array.from(grid.entries());
    if (existingCells.length === 0) return null;

    for (let i = 0; i < answer.length; i++) {
      const ch = answer[i];
      for (const [cellKey, cellCh] of existingCells) {
        if (cellCh !== ch) continue;
        const [gr, gc] = cellKey.split(",").map(Number);

        // Try across crossing at (gr,gc) with word[i]
        {
          const row = gr;
          const col = gc - i;
          const check = canPlace(answer, row, col, "across");
          if (check && (!best || check.score > best.score)) {
            best = { row, col, dir: "across", score: check.score };
          }
        }

        // Try down crossing at (gr,gc) with word[i]
        {
          const row = gr - i;
          const col = gc;
          const check = canPlace(answer, row, col, "down");
          if (check && (!best || check.score > best.score)) {
            best = { row, col, dir: "down", score: check.score };
          }
        }
      }
    }

    return best;
  }

  // Place longer words first for a more connected, compact layout
  const order = entries
    .map((e, idx) => ({ idx, len: e.answer.length }))
    .sort((a, b) => b.len - a.len);

  // Seed with the longest word at the origin, across
  {
    const first = order.shift();
    placeWordAt(first.idx, entries[first.idx].answer, 0, 0, "across");
  }

  for (const item of order) {
    const index = item.idx;
    const answer = entries[index].answer;
    const placement = bestPlacement(answer);
    if (placement) {
      placeWordAt(index, answer, placement.row, placement.col, placement.dir);
      continue;
    }

    // Fallback: create a separated "mini area" below the current bounds.
    // Keep it valid (no touching) and allow future crossings within that area.
    const tryRow = maxRow + 2;
    const tryCol = minCol;
    placeWordAt(index, answer, tryRow, tryCol, "across");
  }

  return { grid, placed, minRow, maxRow, minCol, maxCol };
}

function buildJson(entries, gridInfo) {
  const { grid, placed, minRow, maxRow, minCol, maxCol } = gridInfo;
  const rows = maxRow - minRow + 1;
  const cols = maxCol - minCol + 1;

  const letterAt = new Map();
  for (const [k, ch] of grid.entries()) {
    const [r, c] = k.split(",").map(Number);
    const nr = r - minRow;
    const nc = c - minCol;
    letterAt.set(key(nr, nc), ch);
  }

  // Prepare grid structure
  const gridJson = [];
  for (let r = 0; r < rows; r++) {
    const rowArr = [];
    for (let c = 0; c < cols; c++) {
      const k = key(r, c);
      const ch = letterAt.get(k);
      if (ch) {
        rowArr.push({
          row: r,
          col: c,
          solution: ch,
          isBlock: false,
        });
      } else {
        rowArr.push({
          row: r,
          col: c,
          isBlock: true,
        });
      }
    }
    gridJson.push(rowArr);
  }

  const startKey = (r, c, dir) => r + "," + c + "," + dir;
  const startToEntry = new Map(); // "r,c,dir" -> { index, entry }

  for (const p of placed) {
    const sr = p.row - minRow;
    const sc = p.col - minCol;
    const k = startKey(sr, sc, p.dir);
    if (startToEntry.has(k)) {
      throw new Error("Duplicate start placement at " + k);
    }
    startToEntry.set(k, { index: p.index, entry: entries[p.index] });
  }

  let clueNumber = 1;
  const numbered = new Map(); // "r,c" -> number
  const acrossClues = [];
  const downClues = [];
  const usedEntries = new Set();

  function hasLetter(r, c) {
    return letterAt.has(key(r, c));
  }

  function assignNumber(r, c) {
    const k = key(r, c);
    if (numbered.has(k)) return numbered.get(k);
    const num = clueNumber++;
    numbered.set(k, num);
    gridJson[r][c].number = num;
    return num;
  }

  function takeRun(r, c, dir) {
    const cells = [];
    let rr = r;
    let cc = c;
    while (rr >= 0 && cc >= 0 && rr < rows && cc < cols && hasLetter(rr, cc)) {
      cells.push({ row: rr, col: cc });
      if (dir === "across") cc++;
      else rr++;
    }
    return cells;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!hasLetter(r, c)) continue;

      const startsAcross = !hasLetter(r, c - 1) && hasLetter(r, c + 1);
      const startsDown = !hasLetter(r - 1, c) && hasLetter(r + 1, c);
      if (!startsAcross && !startsDown) continue;

      const num = assignNumber(r, c);

      if (startsAcross) {
        const run = takeRun(r, c, "across");
        const mapped = startToEntry.get(startKey(r, c, "across"));
        if (!mapped) {
          throw new Error("Missing across entry for start " + startKey(r, c, "across"));
        }
        usedEntries.add(mapped.index);
        acrossClues.push({ number: num, text: mapped.entry.clue, cells: run });
      }

      if (startsDown) {
        const run = takeRun(r, c, "down");
        const mapped = startToEntry.get(startKey(r, c, "down"));
        if (!mapped) {
          throw new Error("Missing down entry for start " + startKey(r, c, "down"));
        }
        usedEntries.add(mapped.index);
        downClues.push({ number: num, text: mapped.entry.clue, cells: run });
      }
    }
  }

  if (usedEntries.size !== entries.length) {
    const missing = [];
    for (let i = 0; i < entries.length; i++) {
      if (!usedEntries.has(i)) missing.push(entries[i].rawAnswer || entries[i].answer);
    }
    throw new Error("Not all CSV entries were used as clues. Missing: " + missing.join(", "));
  }

  const puzzle = {
    title: "Oscars Crossword",
    rows,
    cols,
    grid: gridJson,
    clues: {
      across: acrossClues,
      down: downClues,
    },
  };

  return puzzle;
}

function main() {
  const entries = readCsv();
  if (!entries.length) {
    console.error("No entries parsed from CSV.");
    process.exit(1);
  }

  const gridInfo = buildGrid(entries);
  const puzzle = buildJson(entries, gridInfo);
  fs.writeFileSync(OUT_PATH, JSON.stringify(puzzle, null, 2), "utf8");
  console.log("Wrote crossword JSON to", OUT_PATH);
}

main();

