/**
 * Right Loading Planner - 3D Bin Packing Optimization Engine
 * Implements a 3D coordinate-scan heuristic with stacking, tilt, and weight constraints.
 */

class PackingEngine {
  /**
   * Run optimization algorithm
   * @param {Array} items - List of cargo items (name, type, length, width, height, weight, quantity, stackable, tiltable)
   * @param {Object} containerPreset - Selected container details (length, width, height, maxPayload)
   * @param {Array} allPresets - List of all container presets (for auto-recommendation)
   * @param {boolean} autoRecommend - If true, automatically select the best container preset
   */
  static optimize(items, containerPreset, allPresets = [], autoRecommend = false) {
    // 1. Prepare items: flatten quantity into individual box instances
    let boxInstances = [];
    items.forEach((item, itemIdx) => {
      const qty = parseInt(item.quantity) || 1;
      for (let q = 0; q < qty; q++) {
        boxInstances.push({
          id: `${itemIdx}-${q}`,
          name: item.name,
          type: item.type || 'Cartons',
          l: parseFloat(item.length),
          w: parseFloat(item.width),
          h: parseFloat(item.height),
          weight: parseFloat(item.weight) || 0,
          stackable: item.stackable === 'Yes' || item.stackable === true,
          tiltable: item.tiltable === 'Yes' || item.tiltable === true,
          notes: item.notes || '',
          color: this.getItemColor(item.type)
        });
      }
    });

    // If autoRecommend is true, find the best single container preset that fits everything, 
    // or fallback to multiple container planning.
    let selectedContainer = containerPreset;
    if (autoRecommend && allPresets.length > 0) {
      selectedContainer = this.recommendContainer(boxInstances, allPresets);
    }

    // Run the packing simulation
    const result = this.packIntoContainers(boxInstances, selectedContainer);
    return {
      container: selectedContainer,
      ...result
    };
  }

  /**
   * Pack boxes into one or more containers of a specific type
   */
  static packIntoContainers(boxes, container) {
    let unpackedBoxes = [...boxes];
    // Sort boxes by volume descending, and then by weight descending
    // This places heavier, bulkier boxes at the bottom/back first
    unpackedBoxes.sort((a, b) => {
      const volA = a.l * a.w * a.h;
      const volB = b.l * b.w * b.h;
      if (Math.abs(volB - volA) > 0.0001) {
        return volB - volA;
      }
      return b.weight - a.weight;
    });

    const packedContainers = [];
    
    // Keep packing until all boxes are placed or we reach a logical limit (e.g. 50 containers)
    let containerIndex = 0;
    while (unpackedBoxes.length > 0 && containerIndex < 50) {
      containerIndex++;
      const packingResult = this.packSingleContainer(unpackedBoxes, container);
      
      packedContainers.push({
        id: containerIndex,
        containerInfo: container,
        packedItems: packingResult.packed,
        totalCbm: parseFloat(packingResult.totalCbm.toFixed(3)),
        totalWeight: parseFloat(packingResult.totalWeight.toFixed(2)),
        spaceUtilization: parseFloat(((packingResult.totalCbm / (container.length * container.width * container.height)) * 100).toFixed(1)),
        weightUtilization: parseFloat(((packingResult.totalWeight / container.maxPayload) * 100).toFixed(1)),
        emptySpaceCbm: parseFloat(((container.length * container.width * container.height) - packingResult.totalCbm).toFixed(3))
      });

      // Break if we made no progress to prevent infinite loop
      if (packingResult.packed.length === 0) {
        break;
      }

      // Remove packed items from the queue
      const packedIds = new Set(packingResult.packed.map(p => p.id));
      unpackedBoxes = unpackedBoxes.filter(box => !packedIds.has(box.id));
    }

    return {
      containers: packedContainers,
      unpackedItems: unpackedBoxes, // leftover items that couldn't be packed
      totalContainersRequired: packedContainers.length
    };
  }

  /**
   * Pack as many boxes as possible into a single container
   */
  static packSingleContainer(boxes, container) {
    const packed = [];
    let currentWeight = 0;
    let currentCbm = 0;
    
    // Candidate placement points (x = length axis, y = width axis, z = height axis)
    // We start with the bottom-back-left corner (0, 0, 0)
    let candidatePoints = [{ x: 0, y: 0, z: 0 }];

    for (let box of boxes) {
      // Check weight limit
      if (currentWeight + box.weight > container.maxPayload) {
        continue;
      }

      let placed = false;

      // Sort candidate points:
      // Primary: Z (height) ascending -> load floor first
      // Secondary: X (length/depth) ascending -> load back first
      // Tertiary: Y (width) ascending -> load side-to-side
      candidatePoints.sort((a, b) => {
        if (Math.abs(a.z - b.z) > 0.001) return a.z - b.z;
        if (Math.abs(a.x - b.x) > 0.001) return a.x - b.x;
        return a.y - b.y;
      });

      // Try to place the box at one of the candidate points
      for (let i = 0; i < candidatePoints.length; i++) {
        const pt = candidatePoints[i];
        
        // Determine possible rotations based on tiltability
        const orientations = this.getPossibleOrientations(box);

        for (let orient of orientations) {
          const { l, w, h } = orient;

          // Check if box fits within container walls
          if (
            pt.x + l <= container.length &&
            pt.y + w <= container.width &&
            pt.z + h <= container.height
          ) {
            // Check overlapping with already placed boxes
            const overlaps = packed.some(p => 
              this.isOverlapping(
                pt.x, pt.y, pt.z, l, w, h,
                p.x, p.y, p.z, p.l, p.w, p.h
              )
            );

            if (!overlaps) {
              // Check stacking rules and physical support
              const isSupported = this.checkSupportAndStacking(pt.x, pt.y, pt.z, l, w, h, packed);
              
              if (isSupported) {
                // Placed successfully!
                const newBox = {
                  ...box,
                  x: pt.x,
                  y: pt.y,
                  z: pt.z,
                  l: l,
                  w: w,
                  h: h
                };
                packed.push(newBox);
                currentWeight += box.weight;
                currentCbm += l * w * h;

                // Remove this point from candidates
                candidatePoints.splice(i, 1);

                // Generate new candidate points from the box's top-right-front corners
                // 1. Right corner (X axis)
                candidatePoints.push({ x: pt.x + l, y: pt.y, z: pt.z });
                // 2. Front corner (Y axis)
                candidatePoints.push({ x: pt.x, y: pt.y + w, z: pt.z });
                // 3. Top corner (Z axis)
                candidatePoints.push({ x: pt.x, y: pt.y, z: pt.z + h });

                // Filter out duplicate points and points outside the container bounds
                candidatePoints = this.filterCandidatePoints(candidatePoints, container);

                placed = true;
                break;
              }
            }
          }
        }

        if (placed) break;
      }
    }

    return {
      packed,
      totalWeight: currentWeight,
      totalCbm: currentCbm
    };
  }

  /**
   * Check if two boxes overlap in 3D space
   */
  static isOverlapping(x1, y1, z1, l1, w1, h1, x2, y2, z2, l2, w2, h2) {
    const eps = 0.001; // epsilon to avoid floating point issues
    return (
      x1 + l1 - eps > x2 && x2 + l2 - eps > x1 &&
      y1 + w1 - eps > y2 && y2 + w2 - eps > y1 &&
      z1 + h1 - eps > z2 && z2 + h2 - eps > z1
    );
  }

  /**
   * Determine available 3D dimension permutations for a box
   * - If tiltable: all 6 permutations of (L, W, H)
   * - If NOT tiltable: only Z must equal H (upright orientation), can only swap L and W horizontally.
   */
  static getPossibleOrientations(box) {
    const { l, w, h } = box;
    if (box.tiltable) {
      // 6 permutations of (L, W, H)
      return [
        { l: l, w: w, h: h },
        { l: l, w: h, h: w },
        { l: w, w: l, h: h },
        { l: w, w: h, h: l },
        { l: h, w: l, h: w },
        { l: h, w: w, h: l }
      ];
    } else {
      // Upright orientation only. Z is fixed to Height. Can swap L and W horizontally.
      return [
        { l: l, w: w, h: h },
        { l: w, w: l, h: h }
      ];
    }
  }

  /**
   * Check that a box is physically supported underneath and doesn't rest on non-stackable items
   */
  static checkSupportAndStacking(x, y, z, l, w, h, packedItems) {
    // If on the floor, it's fully supported and valid
    if (z === 0) return true;

    let supportedArea = 0;
    const boxArea = l * w;
    const eps = 0.001;

    // Check all packed items directly below this box (whose top matches our bottom)
    for (let p of packedItems) {
      const isDirectlyBelow = Math.abs((p.z + p.h) - z) < eps;
      if (isDirectlyBelow) {
        // Calculate overlapping footprint
        const xOverlap = Math.max(0, Math.min(x + l, p.x + p.l) - Math.max(x, p.x));
        const yOverlap = Math.max(0, Math.min(y + w, p.y + p.w) - Math.max(y, p.y));
        const overlapArea = xOverlap * yOverlap;

        if (overlapArea > 0) {
          // If we are resting on a non-stackable item, this position is invalid!
          if (!p.stackable) {
            return false;
          }
          supportedArea += overlapArea;
        }
      }
    }

    // Require at least 50% of the box's base area to be supported by other items
    // (In shipping, partial support is common, but floating in mid-air is not)
    return (supportedArea / boxArea) >= 0.45;
  }

  /**
   * Filter candidate points to remove duplicates and coordinates outside container boundaries
   */
  static filterCandidatePoints(points, container) {
    const seen = new Set();
    const filtered = [];
    const eps = 0.001;

    for (let pt of points) {
      // Keep inside container walls
      if (
        pt.x >= 0 && pt.x < container.length - eps &&
        pt.y >= 0 && pt.y < container.width - eps &&
        pt.z >= 0 && pt.z < container.height - eps
      ) {
        // Round coordinates to avoid tiny float differences
        const key = `${pt.x.toFixed(3)},${pt.y.toFixed(3)},${pt.z.toFixed(3)}`;
        if (!seen.has(key)) {
          seen.add(key);
          filtered.push({
            x: parseFloat(pt.x.toFixed(4)),
            y: parseFloat(pt.y.toFixed(4)),
            z: parseFloat(pt.z.toFixed(4))
          });
        }
      }
    }

    return filtered;
  }

  /**
   * Auto-recommend the best container preset that fits all boxes
   */
  static recommendContainer(boxes, presets) {
    if (presets.length === 0) return null;

    // Calculate total cargo volume and weight
   let totalVol = 0;
let totalWeight = 0;

let maxLength = 0;
let maxWidth = 0;
let maxHeight = 0;

boxes.forEach(b => {
    totalVol += b.l * b.w * b.h;
    totalWeight += b.weight;

    maxLength = Math.max(maxLength, b.l);
    maxWidth = Math.max(maxWidth, b.w);
    maxHeight = Math.max(maxHeight, b.h);
});

    // Filter presets that can fit the total weight
    let candidates = presets.filter(p => p.maxPayload >= totalWeight);

// Real logistics container selection

if (maxWidth > 3.5) {
    candidates = candidates.filter(p =>
        p.name.includes('PLATFORM')
    );
}
else if (maxWidth > 2.35) {
    candidates = candidates.filter(p =>
        p.name.includes('FR')
    );
}
else if (maxHeight > 2.69) {
    candidates = candidates.filter(p =>
        p.name.includes('OT')
    );
}
else if (maxHeight > 2.39) {
    candidates = candidates.filter(p =>
        p.name.includes('HC') ||
        p.name.includes('OT')
    );
}
    if (candidates.length === 0) candidates = presets; // fallback

    // Sort presets by volume ascending (smallest first)
    candidates.sort((a, b) => {
      const volA = a.length * a.width * a.height;
      const volB = b.length * b.width * b.height;
      return volA - volB;
    });

    // Test each container preset to see if it can pack everything in 1 container
    for (let preset of candidates) {
      const res = this.packSingleContainer(boxes, preset);
      // If all boxes fit in this single container, recommend it!
      if (res.packed.length === boxes.length) {
        return preset;
      }
    }

    // Default to the largest container (45HC or 40HC) if it doesn't fit in smaller ones
    return presets[presets.length - 1] || presets[0];
  }

  /**
   * Map cargo type to a beautiful, clean color scheme
   */
  static getItemColor(type) {
    const colors = {
      'Cartons': '#19A196',   // Brand Teal
      'Crates': '#E67E22',    // Orange
      'Pallets': '#3498DB',   // Blue
      'Pipes': '#9B59B6',     // Purple
      'Barrels': '#F1C40F',   // Yellow
      'Machinery': '#E74C3C'  // Red
    };
    return colors[type] || '#7F8C8D'; // Grey default
  }
}

window.PackingEngine = PackingEngine;
