/**
 * Right Loading Planner - 3D Container Visualizer Module
 * Utilizes Three.js and OrbitControls to build a responsive, interactive 3D container plan.
 */

class ContainerVisualizer {
  /**
   * Initializes the 3D scene
   * @param {HTMLElement} containerEl - The target DOM element to mount the canvas on
   * @param {HTMLElement} tooltipEl - The DOM element to serve as the hover tooltip
   */
  constructor(containerEl, tooltipEl) {
    this.containerEl = containerEl;
    this.tooltipEl = tooltipEl;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.animationFrameId = null;

    // Loading assets storage
    this.containerBox = null;
    this.cargoGroup = null;
    this.containerVolume = null;

    // Raycaster for hover/tooltips
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredMesh = null;
    this.originalColor = null;

    this.initScene();
  }

  initScene() {
    const width = this.containerEl.clientWidth || 800;
    const height = this.containerEl.clientHeight || 450;

    // 1. Scene Setup
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(isDark ? '#11181C' : '#F8F9FA');

    // 2. Camera Setup
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(12, 8, 12); // Default perspective angle

    // 3. Renderer Setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Clear old canvases
    this.containerEl.innerHTML = '';
    this.containerEl.appendChild(this.renderer.domElement);

    // 4. Lights Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight1.position.set(20, 30, 15);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-15, 20, -10);
    this.scene.add(dirLight2);

    // Grid Floor
    const gridColor = isDark ? '#20353B' : '#E2E8F0';
    const gridHelper = new THREE.GridHelper(30, 30, '#19A196', gridColor);
    gridHelper.position.y = 0;
    this.scene.add(gridHelper);

    // 5. Controls Setup
    if (typeof THREE.OrbitControls !== 'undefined') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below floor level
      this.controls.minDistance = 3;
      this.controls.maxDistance = 40;
    } else {
      console.warn('OrbitControls is not loaded. Camera navigation will be locked.');
    }

    // 6. Group to hold cargo meshes
    this.cargoGroup = new THREE.Group();
    this.scene.add(this.cargoGroup);

    // 7. Event listeners
    window.addEventListener('resize', this.onResize.bind(this));
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));

    // Start rendering loop
    this.animate();
  }

  /**
   * Adjust camera and canvas dimensions dynamically
   */
  onResize() {
    if (!this.containerEl || !this.camera || !this.renderer) return;
    const width = this.containerEl.clientWidth;
    const height = this.containerEl.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Handle mouse hover detection
   */
  onMouseMove(event) {
    if (!this.renderer || !this.cargoGroup) return;

    // Calculate mouse position in normalized device coordinates
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.cargoGroup.children, true);

    if (intersects.length > 0) {
      // Hovering over a mesh
      const hitMesh = intersects[0].object;
      
      // Ignore if it's the wireframe outline mesh
      if (hitMesh.name === 'outline') return;

      if (this.hoveredMesh !== hitMesh) {
        // Restore color on previous mesh
        this.resetHover();

        this.hoveredMesh = hitMesh;
        this.originalColor = this.hoveredMesh.material.color.getHex();
        
        // Highlight active mesh (lighten it)
        this.hoveredMesh.material.color.setHex(0xFFFFFF);
        this.hoveredMesh.material.emissive.setHex(0x19A196);
        this.hoveredMesh.material.emissiveIntensity = 0.25;
      }

      // Display tooltip
      const cargoData = hitMesh.userData;
      if (cargoData) {
        this.tooltipEl.style.display = 'block';
        this.tooltipEl.style.left = `${event.clientX + 15}px`;
        this.tooltipEl.style.top = `${event.clientY + 15}px`;
        this.tooltipEl.innerHTML = `
          <strong>${cargoData.name}</strong><br>
          Type: ${cargoData.type}<br>
          Dims: ${cargoData.l.toFixed(2)} x ${cargoData.w.toFixed(2)} x ${cargoData.h.toFixed(2)} m<br>
          Weight: ${cargoData.weight} kg<br>
          Pos (XYZ): ${cargoData.x.toFixed(2)}, ${cargoData.y.toFixed(2)}, ${cargoData.z.toFixed(2)}<br>
          Stackable: ${cargoData.stackable ? 'Yes' : 'No'}
          ${cargoData.isOOG ? `<br><span style="color:#FF7675; font-weight:700;">OOG: ${cargoData.oogDetails}</span>` : ''}
        `;
      }
    } else {
      this.resetHover();
      this.tooltipEl.style.display = 'none';
    }
  }

  resetHover() {
    if (this.hoveredMesh) {
      this.hoveredMesh.material.color.setHex(this.originalColor);
      this.hoveredMesh.material.emissive.setHex(0x000000);
      this.hoveredMesh.material.emissiveIntensity = 0;
      this.hoveredMesh = null;
    }
  }

  /**
   * Render loop
   */
  animate() {
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));

    if (this.controls) {
      this.controls.update();
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Clear old plan, render the container wireframe and pack lists
   */
  renderPlan(containerPreset, packedItems) {
    this.clearPlan();

    // Reset camera target
    const cL = containerPreset.length;
    const cW = containerPreset.width;
    const cH = containerPreset.height;

    if (this.controls) {
      this.controls.target.set(cL / 2, cH / 2, cW / 2);
      this.camera.position.set(cL * 1.5, cH * 2, cW * 1.8);
      this.controls.update();
    }

    // Set container type
    const cType = containerPreset.type || 'Standard';

    // 1. Draw Container Floor Mesh (sleek grey textured appearance)
    const floorGeo = new THREE.BoxGeometry(cL, 0.05, cW);
    const floorMat = new THREE.MeshLambertMaterial({ color: cType === 'Flatbed' ? 0x27AE60 : 0x34495E }); // Green deck for flatbed, dark slate for others
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(cL / 2, -0.025, cW / 2);
    floorMesh.receiveShadow = true;
    this.cargoGroup.add(floorMesh);

    // 2. Draw Walls/Frames dynamically based on container type
    const wallMat = new THREE.MeshPhysicalMaterial({
      color: 0xBDC3C7,
      transparent: true,
      opacity: 0.1,
      roughness: 0.2,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    if (cType === 'Standard') {
      // Full enclosed container walls
      const outerGeo = new THREE.BoxGeometry(cL, cH, cW);
      const edges = new THREE.EdgesGeometry(outerGeo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x7F8C8D, linewidth: 2 });
      const wireframe = new THREE.LineSegments(edges, lineMat);
      wireframe.position.set(cL / 2, cH / 2, cW / 2);
      this.cargoGroup.add(wireframe);

      const wallsMesh = new THREE.Mesh(outerGeo, wallMat);
      wallsMesh.position.set(cL / 2, cH / 2, cW / 2);
      this.cargoGroup.add(wallsMesh);

      // Red door marking/frames at X = cL
      const doorGeo = new THREE.BoxGeometry(0.02, cH, cW);
      const doorMat = new THREE.MeshLambertMaterial({ color: 0xE74C3C, transparent: true, opacity: 0.2 });
      const doorMesh = new THREE.Mesh(doorGeo, doorMat);
      doorMesh.position.set(cL, cH / 2, cW / 2);
      this.cargoGroup.add(doorMesh);

    } else if (cType === 'OpenTop') {
      // Open Top container - draw floor, side walls, and back wall, but no roof
      // Outer wireframe outline (bottom and sides only)
      const wireGeo = new THREE.BoxGeometry(cL, cH, cW);
      const edges = new THREE.EdgesGeometry(wireGeo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x7F8C8D, linewidth: 2 });
      const wireframe = new THREE.LineSegments(edges, lineMat);
      wireframe.position.set(cL / 2, cH / 2, cW / 2);
      this.cargoGroup.add(wireframe);

      // Left Wall
      const leftGeo = new THREE.BoxGeometry(cL, cH, 0.02);
      const leftMesh = new THREE.Mesh(leftGeo, wallMat);
      leftMesh.position.set(cL / 2, cH / 2, -0.01);
      this.cargoGroup.add(leftMesh);

      // Right Wall
      const rightGeo = new THREE.BoxGeometry(cL, cH, 0.02);
      const rightMesh = new THREE.Mesh(rightGeo, wallMat);
      rightMesh.position.set(cL / 2, cH / 2, cW + 0.01);
      this.cargoGroup.add(rightMesh);

      // Back Wall
      const backGeo = new THREE.BoxGeometry(0.02, cH, cW);
      const backMesh = new THREE.Mesh(backGeo, wallMat);
      backMesh.position.set(-0.01, cH / 2, cW / 2);
      this.cargoGroup.add(backMesh);

      // Door Frames (Front posts only)
      const postGeo = new THREE.BoxGeometry(0.05, cH, 0.05);
      const postMat = new THREE.MeshLambertMaterial({ color: 0xE74C3C });
      
      const leftPost = new THREE.Mesh(postGeo, postMat);
      leftPost.position.set(cL, cH / 2, 0);
      this.cargoGroup.add(leftPost);

      const rightPost = new THREE.Mesh(postGeo, postMat);
      rightPost.position.set(cL, cH / 2, cW);
      this.cargoGroup.add(rightPost);

    } else if (cType === 'FlatRack') {
      // Flat Rack container - solid end walls, no side walls, no roof
      const endWallGeo = new THREE.BoxGeometry(0.08, cH, cW);
      const endWallMat = new THREE.MeshLambertMaterial({ color: 0x7F8C8D });
      
      // Back end wall
      const backWall = new THREE.Mesh(endWallGeo, endWallMat);
      backWall.position.set(-0.04, cH / 2, cW / 2);
      this.cargoGroup.add(backWall);

      // Front end wall
      const frontWall = new THREE.Mesh(endWallGeo, endWallMat);
      frontWall.position.set(cL + 0.04, cH / 2, cW / 2);
      this.cargoGroup.add(frontWall);

      // Draw thin bottom side rail bars
      const railGeo = new THREE.BoxGeometry(cL, 0.1, 0.05);
      const railMat = new THREE.MeshLambertMaterial({ color: 0xE74C3C }); // Red warning side rails
      
      const leftRail = new THREE.Mesh(railGeo, railMat);
      leftRail.position.set(cL / 2, 0.05, -0.025);
      this.cargoGroup.add(leftRail);

      const rightRail = new THREE.Mesh(railGeo, railMat);
      rightRail.position.set(cL / 2, 0.05, cW + 0.025);
      this.cargoGroup.add(rightRail);

    } else if (cType === 'Flatbed') {
      // Flatbed trailer deck - no walls at all. We just draw the floor and some warning hazard tape decals
      const hazardGeo = new THREE.BoxGeometry(cL, 0.06, 0.05);
      const hazardMat = new THREE.MeshLambertMaterial({ color: 0xF1C40F }); // Yellow safety outline
      
      const leftDecal = new THREE.Mesh(hazardGeo, hazardMat);
      leftDecal.position.set(cL / 2, 0.03, -0.025);
      this.cargoGroup.add(leftDecal);

      const rightDecal = new THREE.Mesh(hazardGeo, hazardMat);
      rightDecal.position.set(cL / 2, 0.03, cW + 0.025);
      this.cargoGroup.add(rightDecal);
    }

    // 3. Draw Cargo Packed Boxes
    packedItems.forEach(box => {
      // Mesh Geometry (dimensions: l = X length, h = Z height, w = Y width)
      const boxGeo = new THREE.BoxGeometry(box.l, box.h, box.w);
      
      // If item is Out-of-Gauge, make it slightly translucent red/orange warning color or keep original color but highlight outline
      const boxMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(box.isOOG ? '#E67E22' : box.color || '#19A196'),
        transparent: true,
        opacity: box.isOOG ? 0.75 : 0.85
      });
      const mesh = new THREE.Mesh(boxGeo, boxMat);
      
      // Set mesh position (centered on coordinates)
      const posX = box.x + box.l / 2;
      const posY = box.z + box.h / 2; // Z in engine is height
      const posZ = box.y + box.w / 2; // Y in engine is width
      mesh.position.set(posX, posY, posZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Link data for tooltip
      mesh.userData = box;

      // Add a wireframe outline. If OOG, draw a thicker red alert border outline
      const innerEdges = new THREE.EdgesGeometry(boxGeo);
      const edgeColor = box.isOOG ? 0xE74C3C : 0x2C3E50;
      const edgeLineMat = new THREE.LineBasicMaterial({ 
        color: edgeColor, 
        linewidth: box.isOOG ? 3 : 1.5 
      });
      const edgeLines = new THREE.LineSegments(innerEdges, edgeLineMat);
      edgeLines.name = 'outline';
      mesh.add(edgeLines);

      // Add mesh to group
      this.cargoGroup.add(mesh);
    });
  }

  /**
   * Reset the scene
   */
  clearPlan() {
    if (this.cargoGroup) {
      // Clean up meshes and geometries/materials to prevent memory leaks
      while (this.cargoGroup.children.length > 0) {
        const obj = this.cargoGroup.children[0];
        this.cargoGroup.remove(obj);
        
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    }
  }

  // --- PRESET CAMERA ANGLE VIEWS ---
  setViewAngle(viewName, length = 6) {
    if (!this.camera || !this.controls) return;

    const target = this.controls.target;

    switch (viewName) {
      case 'top':
        // Top-down view: Camera directly overhead looking down
        this.camera.position.set(target.x, target.y + 12, target.z);
        break;
      case 'side':
        // Side view: Camera looking along Y-width axis
        this.camera.position.set(target.x, target.y, target.z + 12);
        break;
      case 'front':
        // Front view: Camera looking directly into doors (from X-length end)
        this.camera.position.set(target.x + 12, target.y, target.z);
        break;
      case 'perspective':
      default:
        // Ortho perspective view
        this.camera.position.set(target.x + 8, target.y + 6, target.z + 8);
        break;
    }

    this.controls.update();
  }

  /**
   * Release Three.js resources
   */
  dispose() {
    window.removeEventListener('resize', this.onResize);
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
    }
    
    cancelAnimationFrame(this.animationFrameId);
    this.clearPlan();

    if (this.renderer) {
      this.renderer.dispose();
    }
    
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
  }
}

window.ContainerVisualizer = ContainerVisualizer;
