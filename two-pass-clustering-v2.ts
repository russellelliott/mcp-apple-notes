#!/usr/bin/env bun
import { clusterNotes, listClusters, getNotesInCluster } from "./index.js";
import * as lancedb from "@lancedb/lancedb";

/**
 * Configurable Two-Pass Clustering with Distance Threshold
 * 
 * This version allows fine-tuning of clustering parameters to balance:
 * - Semantic accuracy (avoid pollution of outliers into wrong clusters)
 * - Coverage (percentage of notes assigned to meaningful clusters)
 * - Specificity (min_cluster_size for identifying tight, coherent groups)
 * 
 * Usage:
 *   bun two-pass-clustering-v2.ts                    # Uses defaults
 *   bun two-pass-clustering-v2.ts --min-size=5       # More robust initial clusters
 *   bun two-pass-clustering-v2.ts --distance=1.5     # More strict reassignment threshold
 *   bun two-pass-clustering-v2.ts --min-size=5 --distance=1.5  # Both parameters
 * 
 * Recommended Configurations:
 * - Default (minClusterSize=2, distance=2.0): Good balance, may have some pollution
 * - Conservative (minClusterSize=5, distance=1.5): Favors accuracy, leaves more outliers
 * - Aggressive (minClusterSize=2, distance=3.0): Maximizes coverage, accepts pollution
 */

async function twoPassClusteringV2() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let minClusterSize = 2;
  let distanceThreshold = 2.0;
  
  for (const arg of args) {
    if (arg.startsWith('--min-size=')) {
      minClusterSize = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--distance=')) {
      distanceThreshold = parseFloat(arg.split('=')[1]);
    }
  }
  
  console.log("🎯 Two-Pass Clustering with Distance-Aware Outlier Reassignment\n");
  console.log("Configuration:");
  console.log(`  • minClusterSize: ${minClusterSize} (HDBSCAN min points per cluster)`);
  console.log(`  • distanceThreshold: ${distanceThreshold.toFixed(2)} (max distance to reassign outlier)`);
  console.log(`  • Strategy: Only reassign outliers within distance threshold\n`);
  
  console.log("Pass 1: Initial HDBSCAN clustering");
  console.log("Pass 1.5: Intelligent outlier reassignment (respects distance threshold)");
  console.log("Pass 2: Secondary HDBSCAN on remaining isolated notes\n");
  
  try {
    const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
    const notesTable = await db.openTable("notes");
    
    const allChunks = await notesTable.search("").limit(100000).toArray();
    const uniqueNotes = new Set(allChunks.map(chunk => `${chunk.title}|||${chunk.creation_date}`));
    
    console.log(`📊 Database: ${uniqueNotes.size} notes (${allChunks.length} chunks)\n`);
    
    // ===== RUN CLUSTERING WITH CONFIGURABLE PARAMETERS =====
    console.log("════════════════════════════════════════");
    console.log("🚀 Starting Configurable Two-Pass Clustering");
    console.log("════════════════════════════════════════\n");
    
    const clusterResult = await clusterNotes(notesTable, minClusterSize, true, distanceThreshold);
    
    console.log(`\n✅ Clustering Results:`);
    console.log(`   • Primary clusters: ${clusterResult.totalClusters}`);
    console.log(`   • Total notes: ${clusterResult.totalNotes}`);
    console.log(`   • Notes clustered: ${clusterResult.totalNotes - clusterResult.outliers} (${(((clusterResult.totalNotes - clusterResult.outliers) / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`   • Remaining outliers: ${clusterResult.outliers} (${((clusterResult.outliers / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`   • Time: ${clusterResult.timeSeconds.toFixed(1)}s\n`);
    
    // ===== CLUSTER SIZE DISTRIBUTION =====
    if (clusterResult.clusterSizes.length > 0) {
      console.log("📊 Cluster Size Distribution:");
      clusterResult.clusterSizes.slice(0, 10).forEach((cluster, idx) => {
        const barLength = Math.ceil(cluster.size / 2);
        const bar = "█".repeat(barLength);
        console.log(`   ${String(idx + 1).padStart(2)}. ${cluster.label.padEnd(25)} │ ${bar} ${cluster.size} notes`);
      });
      if (clusterResult.clusterSizes.length > 10) {
        console.log(`   ... and ${clusterResult.clusterSizes.length - 10} more clusters`);
      }
      console.log();
    }
    
    // ===== UNIFIED DISPLAY =====
    console.log("════════════════════════════════════════");
    console.log("📊 FINAL CLUSTER COMPOSITION");
    console.log("════════════════════════════════════════\n");
    
    const finalClusters = await listClusters(notesTable);
    const finalRealClusters = finalClusters.filter(c => c.cluster_id !== '-1');
    
    console.log("🎯 ALL CLUSTERS:\n");
    let totalClustered = 0;
    
    for (let i = 0; i < finalRealClusters.length; i++) {
      const cluster = finalRealClusters[i];
      const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
      totalClustered += notesInCluster.length;
      
      console.log(`📌 Cluster ${i + 1}: "${cluster.cluster_label}"`);
      console.log(`   📊 ${notesInCluster.length} notes`);
      console.log(`   💭 ${cluster.cluster_summary}`);
      console.log(`   📖 Notes:`);
      notesInCluster.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      console.log();
    }
    
    // Display remaining outliers
    const outlierCluster = await getNotesInCluster(notesTable, '-1');
    if (outlierCluster.length > 0) {
      console.log(`📌 OUTLIERS (${outlierCluster.length} notes):`);
      console.log(`   Notes too distant from any cluster (beyond ${distanceThreshold.toFixed(2)} threshold):`);
      outlierCluster.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      console.log();
    }
    
    // ===== FINAL SUMMARY =====
    console.log("════════════════════════════════════════");
    console.log("📈 FINAL SUMMARY");
    console.log("════════════════════════════════════════\n");
    
    console.log(`Configuration Used:`);
    console.log(`  • minClusterSize: ${minClusterSize}`);
    console.log(`  • distanceThreshold: ${distanceThreshold.toFixed(2)}\n`);
    
    console.log(`Results:`);
    console.log(`  • Total notes: ${clusterResult.totalNotes}`);
    console.log(`  • Total clusters: ${finalRealClusters.length}`);
    console.log(`  • Notes in clusters: ${totalClustered} (${((totalClustered / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`  • Remaining outliers: ${outlierCluster.length} (${((outlierCluster.length / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`  • Processing time: ${clusterResult.timeSeconds.toFixed(1)}s`);
    
    console.log(`\n✨ Two-pass clustering complete!`);
    console.log(`   💾 All changes persisted to database`);
    console.log(`   🔍 Using distance-aware outlier reassignment`);
    console.log(`   🎯 HDBSCAN throughout (respects variable cluster shapes/sizes)`);
    
    if (outlierCluster.length === 0) {
      console.log("\n🎉 Full coverage: All notes are now clustered!");
    } else {
      const outlierPct = ((outlierCluster.length / clusterResult.totalNotes) * 100).toFixed(1);
      console.log(`\n💡 Semantic preservation: ${outlierPct}% of notes remain as outliers`);
      console.log(`   These are semantically isolated beyond the ${distanceThreshold.toFixed(2)} threshold`);
      console.log(`\n   To increase coverage, try:`);
      console.log(`   • Increasing distanceThreshold (e.g., --distance=2.5)`);
      console.log(`   • Decreasing minClusterSize (e.g., --min-size=1)`);
      console.log(`   \n   To improve semantic accuracy, try:`);
      console.log(`   • Decreasing distanceThreshold (e.g., --distance=1.5)`);
      console.log(`   • Increasing minClusterSize (e.g., --min-size=5)`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

twoPassClusteringV2();
