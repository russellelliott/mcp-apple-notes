// Type declarations for density-clustering
declare module 'density-clustering' {
  export class DBSCAN {
    constructor();
    run(dataset: number[][], epsilon: number, minPts: number, distanceFunction?: string): number[][];
  }
  
  export class KMEANS {
    constructor();
    run(dataset: number[][], k: number): number[][];
  }
  
  export class OPTICS {
    constructor();
    run(dataset: number[][], minPts: number, distanceFunction?: string): any[];
  }
}