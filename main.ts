// Sokoban solver: push-optimal per room, stitched together.
//
// Idea: every level is a hallway plus rooms that open onto it through a
// single door. A box that leaves its room can never come back, so each room
// is solved on its own (push-optimal breadth-first search over box
// positions) and the room solutions are concatenated. Dead squares are
// found once with a reverse-pull search from the goals and used to prune.
//
// Only Node built-ins are used. The search budget is a count of states,
// never the wall clock, and every iteration order is fixed, so two runs
// produce byte-identical output.

const fs = require("node:fs");
const path = require("node:path");

// Direction order is fixed everywhere: up, down, left, right.
const DIRS = [
  { dr: -1, dc: 0, step: "u", push: "U" },
  { dr: 1, dc: 0, step: "d", push: "D" },
  { dr: 0, dc: -1, step: "l", push: "L" },
  { dr: 0, dc: 1, step: "r", push: "R" },
];

const MAX_STATES_PER_ROOM = 250000;
const IDS = ["i001", "i002", "i003", "i004", "i005"];

function readLevel(text) {
  const rows = text.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  const height = rows.length;
  const width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  const wall = new Set();
  const goals = new Set();
  const boxes = [];
  let player = -1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const ch = rows[r].charAt(c) || "#";
      const at = r * width + c;
      if (ch === "#") wall.add(at);
      else if (ch === ".") goals.add(at);
      else if (ch === "$") boxes.push(at);
      else if (ch === "*") { boxes.push(at); goals.add(at); }
      else if (ch === "@") player = at;
      else if (ch === " ") { /* open floor */ }
      else wall.add(at);
    }
  }
  boxes.sort(function (a, b) { return a - b; });
  return { width: width, height: height, wall: wall, goals: goals, boxes: boxes, player: player };
}

function neighbours(at, width) {
  const r = Math.floor(at / width);
  const c = at % width;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const nr = r + DIRS[i].dr;
    const nc = c + DIRS[i].dc;
    if (nr < 0 || nc < 0) continue;
    out.push({ at: nr * width + nc, dir: i });
  }
  return out;
}

// A square is live when a box standing on it can be pulled onto a goal,
// ignoring other boxes. Found by walking pushes backwards from the goals:
// a state is (box square, player square); reverse a push by moving the box
// back to where the player stood and the player one step further back,
// and let the player walk freely around the box.
function liveSquares(board) {
  const live = new Set();
  const seen = new Set();
  const queue = [];
  board.goals.forEach(function (goal) {
    live.add(goal);
    neighbours(goal, board.width).forEach(function (nb) {
      if (board.wall.has(nb.at)) return;
      const key = goal + ":" + nb.at;
      if (seen.has(key)) return;
      seen.add(key);
      queue.push([goal, nb.at]);
    });
  });
  for (let head = 0; head < queue.length; head++) {
    const box = queue[head][0];
    const player = queue[head][1];
    // Player steps to a neighbouring square without touching the box.
    neighbours(player, board.width).forEach(function (nb) {
      if (board.wall.has(nb.at) || nb.at === box) return;
      const key = box + ":" + nb.at;
      if (seen.has(key)) return;
      seen.add(key);
      queue.push([box, nb.at]);
    });
    // Reverse a push: the player stands next to the box; the box came
    // from the player's square and the player from one step beyond it.
    neighbours(box, board.width).forEach(function (nb) {
      if (nb.at !== player) return;
      const r = Math.floor(player / board.width);
      const c = player % board.width;
      const br = r + DIRS[nb.dir].dr;
      const bc = c + DIRS[nb.dir].dc;
      if (br < 0 || bc < 0) return;
      const back = br * board.width + bc;
      if (board.wall.has(back)) return;
      const key = player + ":" + back;
      if (seen.has(key)) return;
      seen.add(key);
      live.add(player);
      queue.push([player, back]);
    });
  }
  return live;
}

// Split the floor into rooms: remove every square of the player's row
// (the hallway) that is not live, then flood-fill what is left. Each
// component holding boxes is one room. Returns null when the split does
// not account for every box.
function findRooms(board, live) {
  const hallwayRow = Math.floor(board.player / board.width);
  const cut = new Set(board.wall);
  for (let c = 0; c < board.width; c++) {
    const at = hallwayRow * board.width + c;
    if (!live.has(at)) cut.add(at);
  }
  const compOf = new Map();
  let nextComp = 0;
  const total = board.width * board.height;
  for (let at = 0; at < total; at++) {
    if (cut.has(at) || compOf.has(at)) continue;
    nextComp++;
    const queue = [at];
    compOf.set(at, nextComp);
    for (let head = 0; head < queue.length; head++) {
      neighbours(queue[head], board.width).forEach(function (nb) {
        if (cut.has(nb.at) || compOf.has(nb.at)) return;
        compOf.set(nb.at, nextComp);
        queue.push(nb.at);
      });
    }
  }
  const rooms = new Map();
  board.boxes.forEach(function (box) {
    const comp = compOf.get(box);
    if (comp === undefined) return;
    if (!rooms.has(comp)) rooms.set(comp, { squares: [], boxes: [], goals: [] });
    rooms.get(comp).boxes.push(box);
  });
  compOf.forEach(function (comp, at) {
    if (!rooms.has(comp)) return;
    rooms.get(comp).squares.push(at);
    if (board.goals.has(at)) rooms.get(comp).goals.push(at);
  });
  const list = [];
  rooms.forEach(function (room) {
    room.boxes.sort(function (a, b) { return a - b; });
    room.goals.sort(function (a, b) { return a - b; });
    room.squares.sort(function (a, b) { return a - b; });
    if (room.boxes.length !== room.goals.length) return;
    list.push(room);
  });
  const covered = list.reduce(function (n, room) { return n + room.boxes.length; }, 0);
  if (covered !== board.boxes.length) return null;
  list.sort(function (a, b) { return a.squares[0] - b.squares[0]; });
  return list;
}

// Squares the player can stand on from `from`, without stepping through
// walls, the given obstacles, or any box in `boxes`.
function reachableRegion(board, from, obstacles, boxes) {
  const blocked = new Set(obstacles);
  boxes.forEach(function (b) { blocked.add(b); });
  const region = new Set([from]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    neighbours(queue[head], board.width).forEach(function (nb) {
      if (board.wall.has(nb.at) || blocked.has(nb.at) || region.has(nb.at)) return;
      region.add(nb.at);
      queue.push(nb.at);
    });
  }
  return region;
}

// Shortest walk from `from` to `to` over open floor (walls, obstacles and
// boxes are impassable). Returns the lowercase step string, or null.
function walkPath(board, from, to, obstacles, boxes) {
  if (from === to) return "";
  const blocked = new Set(obstacles);
  boxes.forEach(function (b) { blocked.add(b); });
  const prev = new Map();
  prev.set(from, null);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const list = neighbours(cur, board.width);
    for (let i = 0; i < list.length; i++) {
      const nb = list[i];
      if (board.wall.has(nb.at) || blocked.has(nb.at) || prev.has(nb.at)) continue;
      prev.set(nb.at, { from: cur, dir: nb.dir });
      if (nb.at === to) {
        let steps = "";
        let at = to;
        while (at !== from) {
          const step = prev.get(at);
          steps = DIRS[step.dir].step + steps;
          at = step.from;
        }
        return steps;
      }
      queue.push(nb.at);
    }
  }
  return null;
}

// True when the box at `at` sits in a frozen 2x2 block: every cell of
// some 2x2 square containing it is a wall or a box, and the box is not
// already on a goal.
function frozenInBlock(board, at, boxSet) {
  if (board.goals.has(at)) return false;
  const r = Math.floor(at / board.width);
  const c = at % board.width;
  for (let dr = -1; dr <= 0; dr++) {
    for (let dc = -1; dc <= 0; dc++) {
      let filled = true;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const rr = r + dr + i;
          const cc = c + dc + j;
          const cell = rr < 0 || cc < 0 || rr >= board.height || cc >= board.width
            ? -1
            : rr * board.width + cc;
          if (cell !== -1 && !board.wall.has(cell) && !boxSet.has(cell)) filled = false;
        }
      }
      if (filled) return true;
    }
  }
  return false;
}

// Push-optimal breadth-first search for one room. `startBoxes` are the
// room's boxes now, `startPlayer` is where the player stands, and
// `obstacles` are the other rooms' boxes, treated as walls. Returns the
// list of pushes ({box, dir}) from start to solved, or null.
function solveRoom(board, live, roomGoals, startBoxes, startPlayer, obstacles) {
  const goalSet = new Set(roomGoals);
  const solved = function (boxes) {
    return boxes.every(function (b) { return goalSet.has(b); });
  };
  const keyOf = function (boxes, regionLow) {
    return boxes.join(",") + "|" + regionLow;
  };

  const startRegion = reachableRegion(board, startPlayer, obstacles, startBoxes);
  let regionLow = Infinity;
  startRegion.forEach(function (at) { if (at < regionLow) regionLow = at; });
  const startKey = keyOf(startBoxes, regionLow);
  const seen = new Map();
  seen.set(startKey, { boxes: startBoxes.slice(), player: startPlayer, prev: null, push: null });
  const queue = [startKey];
  let solvedKey = null;
  if (solved(startBoxes)) solvedKey = startKey;

  for (let head = 0; head < queue.length && solvedKey === null; head++) {
    const state = seen.get(queue[head]);
    if (seen.size >= MAX_STATES_PER_ROOM) break;
    const region = reachableRegion(board, state.player, obstacles, state.boxes);
    const boxSet = new Set(state.boxes);
    for (let bi = 0; bi < state.boxes.length; bi++) {
      const box = state.boxes[bi];
      for (let d = 0; d < 4; d++) {
        const r = Math.floor(box / board.width);
        const c = box % board.width;
        const tr = r + DIRS[d].dr;
        const tc = c + DIRS[d].dc;
        const br = r - DIRS[d].dr;
        const bc = c - DIRS[d].dc;
        if (tr < 0 || tc < 0 || tr >= board.height || tc >= board.width) continue;
        if (br < 0 || bc < 0 || br >= board.height || bc >= board.width) continue;
        const target = tr * board.width + tc;
        const behind = br * board.width + bc;
        if (board.wall.has(target) || obstacles.has(target) || boxSet.has(target)) continue;
        if (!region.has(behind)) continue;
        const nextBoxes = state.boxes.slice();
        nextBoxes[bi] = target;
        nextBoxes.sort(function (a, b) { return a - b; });
        // Dead-square prune.
        let dead = false;
        for (let i = 0; i < nextBoxes.length; i++) {
          if (!live.has(nextBoxes[i])) { dead = true; break; }
        }
        if (dead) continue;
        const nextBoxSet = new Set(nextBoxes);
        obstacles.forEach(function (b) { nextBoxSet.add(b); });
        if (frozenInBlock(board, target, nextBoxSet)) continue;
        // The player ends the push standing on the box's old square.
        const nextRegion = reachableRegion(board, box, obstacles, nextBoxes);
        let low = Infinity;
        nextRegion.forEach(function (at) { if (at < low) low = at; });
        const key = keyOf(nextBoxes, low);
        if (seen.has(key)) continue;
        seen.set(key, {
          boxes: nextBoxes,
          player: box,
          prev: queue[head],
          push: { box: box, dir: d },
        });
        if (solved(nextBoxes)) { solvedKey = key; break; }
        queue.push(key);
      }
      if (solvedKey !== null) break;
    }
  }
  if (solvedKey === null) return null;
  const pushes = [];
  let at = solvedKey;
  while (seen.get(at).push !== null) {
    pushes.push(seen.get(at).push);
    at = seen.get(at).prev;
  }
  pushes.reverse();
  return pushes;
}

// Turn a push list into a move string, walking the player to each push
// with the shortest path. Returns {moves, player, boxes} or null.
function pushesToMoves(board, pushes, startBoxes, startPlayer, obstacles) {
  let moves = "";
  let player = startPlayer;
  const boxes = startBoxes.slice();
  for (let i = 0; i < pushes.length; i++) {
    const push = pushes[i];
    const r = Math.floor(push.box / board.width);
    const c = push.box % board.width;
    const behind = (r - DIRS[push.dir].dr) * board.width + (c - DIRS[push.dir].dc);
    const walk = walkPath(board, player, behind, obstacles, boxes);
    if (walk === null) return null;
    moves += walk;
    moves += DIRS[push.dir].push;
    const idx = boxes.indexOf(push.box);
    boxes[idx] = (r + DIRS[push.dir].dr) * board.width + (c + DIRS[push.dir].dc);
    boxes.sort(function (a, b) { return a - b; });
    player = push.box;
  }
  return { moves: moves, player: player, boxes: boxes };
}

function solveLevel(board) {
  const live = liveSquares(board);
  const rooms = findRooms(board, live);
  // Whole-level fallback when the board does not split into rooms.
  const jobs = rooms !== null ? rooms : [{
    boxes: board.boxes.slice(),
    goals: Array.from(board.goals).sort(function (a, b) { return a - b; }),
  }];
  let player = board.player;
  const currentBoxes = board.boxes.slice();
  let answer = "";
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const roomBoxes = job.boxes.map(function (b) {
      return currentBoxes[currentBoxes.indexOf(b)];
    });
    const obstacles = new Set();
    currentBoxes.forEach(function (b) {
      if (roomBoxes.indexOf(b) === -1) obstacles.add(b);
    });
    const pushes = solveRoom(board, live, job.goals, roomBoxes, player, obstacles);
    if (pushes === null) return "";
    const done = pushesToMoves(board, pushes, roomBoxes, player, obstacles);
    if (done === null) return "";
    answer += done.moves;
    player = done.player;
    // Refresh the global box positions with this room's solved boxes.
    const nextBoxes = [];
    currentBoxes.forEach(function (b) {
      if (roomBoxes.indexOf(b) === -1) nextBoxes.push(b);
    });
    done.boxes.forEach(function (b) { nextBoxes.push(b); });
    nextBoxes.sort(function (a, b) { return a - b; });
    currentBoxes.length = 0;
    nextBoxes.forEach(function (b) { currentBoxes.push(b); });
  }
  return answer;
}

function main() {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  IDS.forEach(function (id) {
    const levelPath = path.join(inputDir, id, "level.txt");
    let solution = "";
    try {
      const board = readLevel(fs.readFileSync(levelPath, "utf8"));
      solution = solveLevel(board);
    } catch (err) {
      solution = "";
    }
    const dir = path.join(outputDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "solution.txt"), solution, "utf8");
  });
}

main();
