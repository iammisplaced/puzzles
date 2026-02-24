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

  function placeWordAt(index, answer, row, col, dir) {
    for (let i = 0; i < answer.length; i++) {
      const r = dir === "across" ? row : row + i;
      const c = dir === "across" ? col + i : col;
      const k = key(r, c);
      const ch = answer[i];
      const existing = grid.get(k);
      if (existing && existing !== ch) {
        throw new Error("Conflict in forced placement");
      }
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

  function findPlacement(answer, preferDir) {
    let best = null;

    // Collect existing letter cells
    const existingCells = Array.from(grid.entries());
    if (existingCells.length === 0) {
      return null;
    }

    for (let i = 0; i < answer.length; i++) {
      const ch = answer[i];
      for (const [cellKey, cellCh] of existingCells) {
        if (cellCh !== ch) continue;
        const [gr, gc] = cellKey.split(",").map(Number);

        const dirs = preferDir === "down" ? ["down", "across"] : ["across", "down"];

        for (const dir of dirs) {
          const row = dir === "across" ? gr : gr - i;
          const col = dir === "across" ? gc - i : gc;

          let conflict = false;
          let touches = 0;

          for (let j = 0; j < answer.length; j++) {
            const r = dir === "across" ? row : row + j;
            const c = dir === "across" ? col + j : col;
            const k = key(r, c);
            const existing = grid.get(k);
            if (existing) {
              if (existing !== answer[j]) {
                conflict = true;
                break;
              } else {
                touches++;
              }
            }
          }
          if (conflict || touches === 0) continue;

          // Simple scoring: more overlaps is better; smaller bounding box is better
          let newMinRow = minRow;
          let newMaxRow = maxRow;
          let newMinCol = minCol;
          let newMaxCol = maxCol;
          for (let j = 0; j < answer.length; j++) {
            const r = dir === "across" ? row : row + j;
            const c = dir === "across" ? col + j : col;
            if (r < newMinRow) newMinRow = r;
            if (r > newMaxRow) newMaxRow = r;
            if (c < newMinCol) newMinCol = c;
            if (c > newMaxCol) newMaxCol = c;
          }
          const height = newMaxRow - newMinRow + 1;
          const width = newMaxCol - newMinCol + 1;
          const area = height * width;
          const score = touches * 1000 - area; // prioritize overlaps heavily

          if (!best || score > best.score) {
            best = { row, col, dir, score };
          }
        }
      }
    }

    return best;
  }

  entries.forEach((entry, index) => {
    const answer = entry.answer;
    if (index === 0) {
      // Place first word across at origin
      placeWordAt(index, answer, 0, 0, "across");
      return;
    }

    const preferDir = index % 2 === 0 ? "down" : "across";
    const placement = findPlacement(answer, preferDir);
    if (placement) {
      placeWordAt(index, answer, placement.row, placement.col, placement.dir);
    } else {
      // Fallback: place below everything, across
      const row = maxRow + 2;
      const col = 0;
      placeWordAt(index, answer, row, col, "across");
    }
  });

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

  // Index placed words by start position + direction
  const placedByStart = new Map(); // "r,c,dir" -> placed entry
  placed.forEach((p) => {
    const sr = p.row - minRow;
    const sc = p.col - minCol;
    placedByStart.set(sr + "," + sc + "," + p.dir, p);
  });

  let clueNumber = 1;
  const cellNumber = new Map(); // "r,c" -> number
  const acrossClues = [];
  const downClues = [];

  function assignNumber(r, c) {
    const k = key(r, c);
    if (cellNumber.has(k)) return cellNumber.get(k);
    const num = clueNumber++;
    cellNumber.set(k, num);
    const cell = gridJson[r][c];
    cell.number = num;
    return num;
  }

  // Build clues from placed words
  for (const p of placed) {
    const entry = entries[p.index];
    const sr = p.row - minRow;
    const sc = p.col - minCol;

    const isAcross = p.dir === "across";
    const list = isAcross ? acrossClues : downClues;

    // Determine if this word actually starts here in its direction
    if (isAcross) {
      const leftCol = sc - 1;
      if (leftCol >= 0) {
        const kLeft = key(sr, leftCol);
        if (letterAt.has(kLeft)) {
          continue; // not a start
        }
      }
    } else {
      const upRow = sr - 1;
      if (upRow >= 0) {
        const kUp = key(upRow, sc);
        if (letterAt.has(kUp)) {
          continue; // not a start
        }
      }
    }

    const num = assignNumber(sr, sc);
    const cells = [];
    for (let i = 0; i < p.answer.length; i++) {
      const r = isAcross ? sr : sr + i;
      const c = isAcross ? sc + i : sc;
      cells.push({ row: r, col: c });
    }

    list.push({
      number: num,
      text: entry.clue,
      cells,
    });
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

