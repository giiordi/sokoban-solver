# Sokoban Solver

A push-optimal Sokoban solver in plain TypeScript (Node 22, built-ins only).
It reads each level from `MAKEFUN_INPUT_DIR` (default `/input`) and writes
the move string to `MAKEFUN_OUTPUT_DIR` (default `/output`).

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/giiordi/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/giiordi/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Support the entry: <http://make.fun/r/v0wjehd6>

## How it works

1. **Dead squares**: a reverse-pull search from the goals marks every
   square a box can ever stand on; anything else is pruned.
2. **Room split**: the hallway row is cut at non-live squares and the
   floor flood-fills into rooms, each holding its own boxes and goals.
3. **Push-optimal search**: each room is solved with a breadth-first
   search over box positions (FIFO by pushes), with the player's reachable
   region as part of the state and frozen 2x2 blocks pruned. Other rooms'
   boxes count as walls while one room is solved.
4. **Stitching**: the rooms' move strings are concatenated, carrying the
   player position from one room to the next.

The search budget is a state count, never the clock, and every iteration
order is fixed, so runs are deterministic.

## How to run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```
