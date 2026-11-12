import { readFileSync } from "node:fs";
import { AggregateFile, Catalog, GameRow, LevelgenAggregate } from "../src/index.ts";

const dir = new URL("../fixtures/", import.meta.url);
const json = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

Catalog.parse(json("catalog.json"));
LevelgenAggregate.parse(json("levelgen.json"));
AggregateFile.parse(json("aggregate.json"));
readFileSync(new URL("games.jsonl", dir), "utf8")
  .split("\n")
  .filter(Boolean)
  .forEach((l) => GameRow.parse(JSON.parse(l)));
console.log("fixtures ok");
