
import * as lancedb from "@lancedb/lancedb";
import path from "node:path";
import os from "node:os";

async function main() {
  const dbPath = path.join(os.homedir(), ".mcp-apple-notes", "data");
  const db = await lancedb.connect(dbPath);
  try {
    const table = await db.openTable("notes");
    console.log("Table schema:");
    const schema = await table.schema();
    console.log(JSON.stringify(schema, null, 2));
  } catch (e) {
    console.error("Error opening table:", e);
  }
}

main();
