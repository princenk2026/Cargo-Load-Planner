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

    // 1. Draw Container Floor Mesh (sleek grey textured appearance)
    const floorGeo = new THREE.BoxGeometry(cL, 0.05, cW);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x34495E }); // dark charcoal floor
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(cL / 2, -0.025, cW / 2);
    floorMesh.receiveShadow = true;
    this.cargoGroup.add(floorMesh);

    // 2. Draw Container Transparent Wall Outline
    const outerGeo = new THREE.BoxGeometry(cL, cH, cW);
    
    // Thin wireframe edges
    const edges = new THREE.EdgesGeometry(outerGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x7F8C8D, linewidth: 2 });
    const wireframe = new THREE.LineSegments(edges, lineMat);
    wireframe.position.set(cL / 2, cH / 2, cW / 2);
    this.cargoGroup.add(wireframe);

    // Side panels (semitransparent to allow seeing contents)
    const wallMat = new THREE.MeshPhysicalMaterial({
      color: 0xBDC3C7,
      transparent: true,
      opacity: 0.1,
      roughness: 0.2,
      metalness: 0.1,
      side: THREE.BackSide,
      depthWrite: false
    });
    const wallsMesh = new THREE.Mesh(outerGeo, wallMat);
    wallsMesh.position.set(cL / 2, cH / 2, cW / 2);
    this.cargoGroup.add(wallsMesh);

    // Door Frames (representing the front cargo entry door at X = cL)
    const doorGeo = new THREE.BoxGeometry(0.02, cH, cW);
    const doorMat = new THREE.MeshLambertMaterial({
      color: 0xE74C3C, // Red door markings
      transparent: true,
      opacity: 0.2
    });
    const doorMesh = new THREE.Mesh(doorGeo, doorMat);
    doorMesh.position.set(cL, cH / 2, cW / 2);
    this.cargoGroup.add(doorMesh);

    // 3. Draw Cargo Packed Boxes
    packedItems.forEach(box => {
      // Mesh Geometry (dimensions: l = X length, h = Z height, w = Y width)
      // Note: Three.js axes map to: Length along X, Height along Y, Width along Z
      // Let's map our Packing Engine coordinates:
      // Engine X -> Three.js X (length)
      // Engine Y -> Three.js Z (width)
      // Engine Z -> Three.js Y (height)
      const boxGeo = new THREE.BoxGeometry(box.l, box.h, box.w);
      const boxMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(box.color || '#19A196'),
        transparent: true,
        opacity: 0.85
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

      // Add a thin edge wireframe around each cargo mesh to separate them visually
      const innerEdges = new THREE.EdgesGeometry(boxGeo);
      const edgeLineMat = new THREE.LineBasicMaterial({ color: 0x2C3E50, linewidth: 1.5 });
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
