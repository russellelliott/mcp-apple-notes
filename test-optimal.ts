#!/usr/bin/env bun
import { createNotesTable, clusterNotes, listClusters, getNotesInCluster } from "./index.js";

async function testOptimalClustering() {
  console.log("🧪 Testing clustering with optimal parameters...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Based on similarity analysis:
    // - Min distance: 0.541 (Speed Dating ↔ Hiking Meetups) 
    // - Most pairs within distance at ε=1.0: 24 pairs
    // - Try ε=0.6 to capture the most similar pairs only
    
    console.log("🔬 Running DBSCAN with optimal parameters...");
    console.log("   • min_cluster_size = 2");
    console.log("   • epsilon = 0.6 (captures most similar notes)");
    
    const clusterResult = await clusterNotes(
      notesTable, 
      2,   // min_cluster_size = 2 
      0.6  // epsilon = 0.6 (between min 0.541 and next level)
    );
    
    console.log("\n📊 Clustering Results:");
    console.log(`• Total clusters: ${clusterResult.totalClusters}`);
    console.log(`• Outlier notes: ${clusterResult.outliers}`);
    
    // List all clusters with details
    const clusters = await listClusters(notesTable);
    
    console.log("\n📋 All clusters found:");
    let clusterNum = 1;
    
    for (const cluster of clusters) {
      const isOutlier = cluster.cluster_id === '-1';
      const emoji = isOutlier ? '📌' : '🎯';
      
      console.log(`\n${emoji} ${clusterNum}. ${cluster.cluster_label} (ID: ${cluster.cluster_id})`);
      console.log(`   📊 ${cluster.note_count} notes`);
      console.log(`   📝 ${cluster.cluster_summary}`);
      
      if (!isOutlier) {
        // Show notes in this cluster
        const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
        console.log(`   📖 Notes:`);
        notesInCluster.forEach((note, idx) => {
          console.log(`      ${idx + 1}. "${note.title}"`);
        });
      } else if (cluster.note_count <= 5) {
        // Show outlier notes if not too many
        const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
        console.log(`   📖 Outlier notes:`);
        notesInCluster.forEach((note, idx) => {
          console.log(`      ${idx + 1}. "${note.title}"`);
        });
      }
      
      clusterNum++;
    }
    
  } catch (error) {
    console.error("\n❌ Error:", error);
  }
  
  process.exit(0);
}

testOptimalClustering();