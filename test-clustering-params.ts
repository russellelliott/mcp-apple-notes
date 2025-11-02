#!/usr/bin/env bun
import { clusterNotes } from "./index.js";
import * as lancedb from "@lancedb/lancedb";

async function testClusteringParams() {
  console.log("🧪 Testing different clustering parameters...\n");
  
  try {
    const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
    const notesTable = await db.openTable("notes");
    
    // Test different epsilon values - focused on the sweet spot between 0.7 and 0.8
    const epsilonValues = [0.70, 0.72, 0.74, 0.76, 0.78, 0.80];
    
    console.log("Testing epsilon values between 0.7-0.8 (finding optimal balance):\n");
    console.log("Epsilon | Valid Clusters | Clustered Notes | Outliers | Clustering Rate");
    console.log("--------|----------------|-----------------|----------|----------------");
    
    for (const epsilon of epsilonValues) {
      try {
        const result = await clusterNotes(notesTable, 2, epsilon, false);
        const clusteringRate = ((result.totalNotes - result.outliers) / result.totalNotes * 100).toFixed(1);
        console.log(
          `  ${epsilon.toFixed(1)}   |      ${result.totalClusters}       |       ${result.totalNotes - result.outliers}        |   ${result.outliers}    |   ${clusteringRate}%`
        );
      } catch (error) {
        console.log(`  ${epsilon.toFixed(1)}   | ❌ Error: ${(error as Error).message.slice(0, 30)}`);
      }
    }
    
    console.log("\n📊 Recommendation:");
    console.log("   - Lower epsilon (0.3-0.5): More clusters, fewer outliers but less grouping");
    console.log("   - Higher epsilon (0.7-1.0): Fewer clusters, more grouping but risk of over-clustering");
    console.log("   - Aim for 40-60% clustering rate for good balance");
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

testClusteringParams();
