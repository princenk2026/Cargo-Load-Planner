/**
 * Right Loading Planner - Main Application Logic
 * Integrates Router, Authentication, CRUD database sync, Excel upload/downloads,
 * 3D visualizer hookups, and PDF reporting.
 */

class AppController {
  constructor() {
    this.currentUser = null;
    this.currentShipment = null;
    this.cargoItems = [];
    
    // Catalog arrays loaded from db
    this.containersList = [];
    this.customersList = [];
    this.usersList = [];
    this.settings = {};

    // Visualizer instance
    this.visualizer = null;
    this.activePackingResult = null;

    // View state
    this.currentView = 'dashboard';
    this.shipmentsViewMode = 'card'; // 'card' or 'table'
    this.shipmentsFilter = 'all';
    
    // Theme state
    this.activeTheme = 'light';
  }

  /**
   * Start App: Init DB, check session, bind events
   */
  async start() {
    try {
      // 1. Initialize DB
      await dbInstance.init();
      await dbInstance.loadPresetsIfNeeded();
      
      // Load configurations
      await this.loadAppConfigs();

      // Initialize Theme
      this.initTheme();

      // 2. Bind global event listeners
      this.bindGlobalEvents();

      // 3. Check Session Persistence
      const session = localStorage.getItem('rl_planner_session');
      if (session) {
        this.currentUser = JSON.parse(session);
        this.showApplicationShell();
      } else {
        this.showAuthScreen();
      }

      // 4. Register Network Status check
      this.updateNetworkStatus();
      window.addEventListener('online', () => this.updateNetworkStatus());
      window.addEventListener('offline', () => this.updateNetworkStatus());

      // Init Lucide Icons globally
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    } catch (err) {
      console.error('Fatal initialization error:', err);
      this.showToast('Initialization failed. Check local storage.', 'error');
    }
  }

  async loadAppConfigs() {
    // Load Containers
    this.containersList = await dbInstance.getAll('containers');
    // Load Customers
    this.customersList = await dbInstance.getAll('customers');
    // Load Users
    this.usersList = await dbInstance.getAll('users');
    
    // Load settings
    const settingsArr = await dbInstance.getAll('settings');
    this.settings = {};
    settingsArr.forEach(s => {
      this.settings[s.key] = s.value;
    });
  }

  // --- SESSION VIEWS TOGGLING ---

  showAuthScreen() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-shell').style.display = 'none';
  }

  showApplicationShell() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-shell').style.display = 'flex';
    
    // Set user profile widgets
    document.getElementById('nav-user-name').innerText = this.currentUser.name;
    document.getElementById('nav-user-role').innerText = this.currentUser.role;
    
    // Create avatar initials
    const initials = this.currentUser.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
    document.getElementById('nav-user-avatar').innerText = initials;

    // Apply role-based visibility restrictions
    this.applyRoleRestrictions();

    // Route to Dashboard
    this.switchView('dashboard');
  }

  applyRoleRestrictions() {
    const role = this.currentUser.role;
    const adminOpsOnlyElements = document.querySelectorAll('[data-role-restricted="admin-ops"]');
    const writeActions = document.querySelectorAll('.write-action');

    if (role === 'Customer') {
      // Hide admin sections
      document.querySelector('[data-target="users"]').style.display = 'none';
      document.querySelector('[data-target="settings"]').style.display = 'none';
      document.getElementById('btn-quick-new-shipment').style.display = 'none';
      
      adminOpsOnlyElements.forEach(el => el.style.display = 'none');
      writeActions.forEach(el => el.setAttribute('disabled', 'true'));
    } else if (role === 'Sales') {
      document.querySelector('[data-target="users"]').style.display = 'none';
      document.querySelector('[data-target="settings"]').style.display = 'none';
      
      adminOpsOnlyElements.forEach(el => el.style.display = 'none');
      writeActions.forEach(el => el.removeAttribute('disabled'));
    } else {
      // Operations or Admin
      document.querySelector('[data-target="users"]').style.display = 'flex';
      document.querySelector('[data-target="settings"]').style.display = 'flex';
      document.getElementById('btn-quick-new-shipment').style.display = 'inline-flex';
      
      adminOpsOnlyElements.forEach(el => el.style.display = 'flex');
      writeActions.forEach(el => el.removeAttribute('disabled'));
    }
  }

  // --- PWA OFFLINE NETWORKING STATE ---
  
  updateNetworkStatus() {
    const isOnline = navigator.onLine;
    const badge = document.getElementById('offline-network-badge');
    const syncDot = document.getElementById('network-sync-dot');
    const syncText = document.getElementById('sync-status-label');

    if (isOnline) {
      badge.classList.remove('visible');
      syncDot.classList.remove('offline');
      syncText.innerText = 'Cloud Synced';
      this.showToast('Online mode active. Caches refreshed.', 'success');
    } else {
      badge.classList.add('visible');
      syncDot.classList.add('offline');
      syncText.innerText = 'Offline Active';
      this.showToast('Network disconnected. Operating on local IndexedDB storage.', 'warning');
    }
  }

  // --- ROUTER VIEW SWITCHING ---

  async switchView(viewName) {
    this.currentView = viewName;

    // Toggle active link highlights
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.getAttribute('data-target') === viewName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Hide all view containers, show target
    document.querySelectorAll('.view-container').forEach(c => {
      c.classList.remove('active');
    });

    const targetEl = document.getElementById(`view-${viewName}`);
    if (targetEl) {
      targetEl.classList.add('active');
    }

    // Set header title
    const headerTitle = document.getElementById('active-view-title');
    headerTitle.innerText = viewName.charAt(0).toUpperCase() + viewName.slice(1).replace('-', ' ');

    // View specific hooks
    if (viewName === 'dashboard') {
      await this.setupDashboardView();
    } else if (viewName === 'shipments') {
      await this.setupShipmentsView();
    } else if (viewName === 'containers') {
      await this.setupContainersView();
    } else if (viewName === 'customers') {
      await this.setupCustomersView();
    } else if (viewName === 'users') {
      await this.setupUsersView();
    } else if (viewName === 'settings') {
      await this.setupSettingsView();
    }

    // Re-trigger icon parsing
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  // --- VIEW CONTROLLERS SETUP ---

  // 1. Dashboard Controller
  async setupDashboardView() {
    const shipments = await dbInstance.getAll('shipments');
    const containers = await dbInstance.getAll('containers');

    // Stats calculations
    // Filter out client listings if customer role logged in
    let filteredShipments = shipments;
    if (this.currentUser.role === 'Customer') {
      filteredShipments = shipments.filter(s => s.customerId === this.currentUser.name);
    }

    const totalCount = filteredShipments.length;
    const completedCount = filteredShipments.filter(s => s.status === 'Completed').length;
    const draftCount = filteredShipments.filter(s => s.status === 'Draft').length;

    // Aggregate containers count & util %
    let totalContainersPlanned = 0;
    let totalUtilization = 0;
    let completedUtilizedCount = 0;

    filteredShipments.forEach(s => {
      if (s.status === 'Completed') {
        totalContainersPlanned += parseInt(s.containerCount) || 1;
        totalUtilization += parseFloat(s.spaceUtilization) || 0;
        completedUtilizedCount++;
      }
    });

    const avgUtil = completedUtilizedCount > 0 ? (totalUtilization / completedUtilizedCount).toFixed(1) : 0;

    // Update UI Stats
    document.getElementById('stat-total-shipments').innerText = totalCount;
    document.getElementById('stat-completed-plans').innerText = completedCount;
    document.getElementById('stat-containers-planned').innerText = totalContainersPlanned;
    document.getElementById('stat-avg-utilization').innerText = `${avgUtil}%`;

    // Render Recent Shipments Table (max 5)
    // Sort recent first
    filteredShipments.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = filteredShipments.slice(0, 5);

    const tbody = document.querySelector('#dashboard-recent-table tbody');
    tbody.innerHTML = '';

    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No loading plans generated yet. Click "Optimize Shipment" to start.</td></tr>';
      return;
    }

    recent.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:var(--font-headings); font-weight:700; color:var(--primary-dark);">${s.shipmentId}</td>
        <td>${s.customerId || 'Walk-in'}</td>
        <td>${new Date(s.date).toLocaleDateString()}</td>
        <td>${s.recommendedContainer} x ${s.containerCount || 1}</td>
        <td>${(s.totalCbm || 0).toFixed(1)} CBM (${s.spaceUtilization || 0}%)</td>
        <td><span class="badge badge-${s.status.toLowerCase()}">${s.status}</span></td>
        <td>
          <button class="btn btn-outline btn-icon" onclick="app.editShipment(${s.id})" title="Edit Plan"><i data-lucide="edit-3"></i></button>
          <button class="btn btn-outline btn-icon btn-icon-danger" onclick="app.deleteShipment(${s.id})" title="Delete Plan"><i data-lucide="trash-2"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 2. Shipments view controller
  async setupShipmentsView() {
    const shipments = await dbInstance.getAll('shipments');
    let filtered = shipments;

    // Customer role filter
    if (this.currentUser.role === 'Customer') {
      filtered = shipments.filter(s => s.customerId === this.currentUser.name);
    }

    // Role-specific filter state
    if (this.shipmentsFilter === 'completed') {
      filtered = filtered.filter(s => s.status === 'Completed');
    } else if (this.shipmentsFilter === 'draft') {
      filtered = filtered.filter(s => s.status === 'Draft');
    }

    // Search filter
    const query = document.getElementById('shipment-search-input').value.toLowerCase();
    if (query) {
      filtered = filtered.filter(s => 
        s.shipmentId.toLowerCase().includes(query) ||
        (s.customerId && s.customerId.toLowerCase().includes(query)) ||
        (s.notes && s.notes.toLowerCase().includes(query))
      );
    }

    // Sort by date descending
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Render Cards or Tables depending on mode toggle
    const cardsContainer = document.getElementById('shipments-cards-container');
    const tableContainer = document.getElementById('shipments-table-card');

    if (this.shipmentsViewMode === 'card') {
      cardsContainer.style.display = 'grid';
      tableContainer.style.display = 'none';
      this.renderShipmentCards(filtered);
    } else {
      cardsContainer.style.display = 'none';
      tableContainer.style.display = 'block';
      this.renderShipmentTable(filtered);
    }
  }

  renderShipmentCards(shipments) {
    const container = document.getElementById('shipments-cards-container');
    container.innerHTML = '';

    if (shipments.length === 0) {
      container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">No matching shipments found.</div>';
      return;
    }

    shipments.forEach(s => {
      const card = document.createElement('div');
      card.className = 'shipment-card';
      card.innerHTML = `
        <div class="shipment-card-header">
          <div>
            <h4 class="shipment-card-title">${s.shipmentId}</h4>
            <span class="shipment-card-date">${new Date(s.date).toLocaleDateString()}</span>
          </div>
          <span class="badge badge-${s.status.toLowerCase()}">${s.status}</span>
        </div>
        <div class="shipment-card-customer">${s.customerId || 'Walk-in Account'}</div>
        
        <div class="shipment-card-stats">
          <div>
            <span class="shipment-stat-label">Container</span>
            <span class="shipment-stat-val">${s.containerCount || 1} x ${s.recommendedContainer}</span>
          </div>
          <div>
            <span class="shipment-stat-label">Space Util</span>
            <span class="shipment-stat-val" style="color:var(--primary-dark); font-weight:800;">${s.spaceUtilization || 0}%</span>
          </div>
          <div>
            <span class="shipment-stat-label">Total CBM</span>
            <span class="shipment-stat-val">${(s.totalCbm || 0).toFixed(2)} m³</span>
          </div>
          <div>
            <span class="shipment-stat-label">Weight</span>
            <span class="shipment-stat-val">${(s.totalWeight || 0).toFixed(0)} kg</span>
          </div>
        </div>

        <div class="shipment-card-actions">
          <button class="btn btn-outline" style="padding:6px 12px; font-size:12px;" onclick="app.editShipment(${s.id})">
            <i data-lucide="edit-3" style="width:14px;height:14px;"></i>
            <span>Open</span>
          </button>
          <button class="btn btn-outline btn-danger" style="padding:6px; color:white;" onclick="app.deleteShipment(${s.id})" title="Delete Shipment">
            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  renderShipmentTable(shipments) {
    const tbody = document.querySelector('#shipments-full-table tbody');
    tbody.innerHTML = '';

    if (shipments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">No matching shipments found.</td></tr>';
      return;
    }

    shipments.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:var(--font-headings); font-weight:700; color:var(--primary-dark);">${s.shipmentId}</td>
        <td>${s.customerId}</td>
        <td>${new Date(s.date).toLocaleDateString()}</td>
        <td>${s.containerCount || 1} x ${s.recommendedContainer}</td>
        <td>${(s.totalCbm || 0).toFixed(2)}</td>
        <td>${(s.totalWeight || 0).toFixed(0)}</td>
        <td style="font-weight:700; color:var(--primary-dark);">${s.spaceUtilization || 0}%</td>
        <td><span class="badge badge-${s.status.toLowerCase()}">${s.status}</span></td>
        <td>
          <button class="btn btn-outline btn-icon" onclick="app.editShipment(${s.id})"><i data-lucide="edit-3"></i></button>
          <button class="btn btn-outline btn-icon btn-icon-danger" onclick="app.deleteShipment(${s.id})"><i data-lucide="trash-2"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 3. Shipment Builder logic
  async setupShipmentBuilderView(shipmentId = null) {
    // Populate customers dropdown
    const customerSelect = document.getElementById('builder-customer');
    customerSelect.innerHTML = '<option value="Walk-in Customer">Walk-in Account</option>';
    this.customersList.forEach(c => {
      customerSelect.innerHTML += `<option value="${c.name}">${c.name} (${c.type})</option>`;
    });

    // Populate Target Containers Preset selection
    const containerSelect = document.getElementById('builder-container-preset');
    containerSelect.innerHTML = '';
    this.containersList.forEach(c => {
      containerSelect.innerHTML += `<option value="${c.id}">${c.name} (Vol: ${c.volume} CBM | Max: ${c.maxPayload} kg)</option>`;
    });

    if (shipmentId) {
      // Load Existing shipment
      const data = await dbInstance.getShipmentWithItems(shipmentId);
      if (data) {
        this.currentShipment = data.shipment;
        this.cargoItems = data.cargoItems;

        document.getElementById('builder-db-id').value = this.currentShipment.id;
        document.getElementById('builder-customer').value = this.currentShipment.customerId;
        document.getElementById('builder-notes').value = this.currentShipment.notes || '';
        document.getElementById('builder-auto-recommend').checked = this.currentShipment.autoRecommend === true;
        
        // Find default container
        const pIdx = this.containersList.findIndex(c => c.name === this.currentShipment.recommendedContainer);
        if (pIdx !== -1) {
          document.getElementById('builder-container-preset').value = this.containersList[pIdx].id;
        }
      }
    } else {
      // New Shipment Setup
      this.currentShipment = {
        shipmentId: '',
        customerId: 'Walk-in Customer',
        status: 'Draft',
        date: new Date().toISOString(),
        notes: '',
        recommendedContainer: '20GP',
        containerCount: 1,
        totalCbm: 0,
        totalWeight: 0,
        spaceUtilization: 0,
        weightUtilization: 0
      };
      this.cargoItems = [];

      document.getElementById('builder-db-id').value = '';
      document.getElementById('builder-customer').value = 'Walk-in Customer';
      document.getElementById('builder-notes').value = '';
      document.getElementById('builder-auto-recommend').checked = false;
      
      // Default to setting container
      const defCont = this.settings.defaultContainerId || 1;
      document.getElementById('builder-container-preset').value = defCont;
    }

    // Reset cargo input fields
    document.getElementById('cargo-entry-form').reset();
    document.getElementById('edit-cargo-idx').value = '';
    document.getElementById('btn-add-cargo-text').innerText = 'Add Item to List';
    document.getElementById('excel-error-log').style.display = 'none';

    this.renderBuilderCargoTable();
  }

  renderBuilderCargoTable() {
    const tbody = document.getElementById('builder-cargo-table-body');
    tbody.innerHTML = '';
    
    let totalQty = 0;

    this.cargoItems.forEach((item, idx) => {
      totalQty += parseInt(item.quantity) || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;">${item.name} <div style="font-size:10px; color:var(--text-muted);">${item.type}</div></td>
        <td>${item.length} x ${item.width} x ${item.height} m</td>
        <td>${item.quantity}</td>
        <td>${item.weight} kg</td>
        <td><span class="badge" style="background:#E2E8F0; font-size:9px;">${item.stackable === 'Yes' ? 'Stack' : 'No Stack'}</span></td>
        <td>
          <button class="btn btn-outline btn-icon" onclick="app.editCargoItem(${idx})"><i data-lucide="edit-3"></i></button>
          <button class="btn btn-outline btn-icon btn-icon-danger" onclick="app.deleteCargoItem(${idx})"><i data-lucide="trash-2"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('badge-total-items-qty').innerText = `${totalQty} Units`;

    if (this.cargoItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">Cargo list is empty. Add items above or upload Excel sheet.</td></tr>';
    }

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  // Add / Edit Cargo row
  saveCargoItem(item) {
    const editIdxVal = document.getElementById('edit-cargo-idx').value;
    if (editIdxVal !== '') {
      // Editing
      const idx = parseInt(editIdxVal);
      this.cargoItems[idx] = item;
      this.showToast('Cargo item updated.', 'success');
    } else {
      // Creating
      this.cargoItems.push(item);
      this.showToast('Cargo item added.', 'success');
    }

    document.getElementById('cargo-entry-form').reset();
    document.getElementById('edit-cargo-idx').value = '';
    document.getElementById('btn-add-cargo-text').innerText = 'Add Item to List';
    
    this.renderBuilderCargoTable();
  }

  editCargoItem(idx) {
    const item = this.cargoItems[idx];
    document.getElementById('edit-cargo-idx').value = idx;
    document.getElementById('cargo-name').value = item.name;
    document.getElementById('cargo-type').value = item.type;
    document.getElementById('cargo-qty').value = item.quantity;
    document.getElementById('cargo-weight').value = item.weight;
    document.getElementById('cargo-length').value = item.length;
    document.getElementById('cargo-width').value = item.width;
    document.getElementById('cargo-height').value = item.height;
    document.getElementById('cargo-stackable').value = item.stackable;
    document.getElementById('cargo-tiltable').value = item.tiltable;
    document.getElementById('cargo-notes').value = item.notes || '';

    document.getElementById('btn-add-cargo-text').innerText = 'Update Item Details';
    document.getElementById('cargo-name').focus();
  }

  deleteCargoItem(idx) {
    this.cargoItems.splice(idx, 1);
    this.showToast('Cargo item removed.', 'warning');
    this.renderBuilderCargoTable();
  }

  // Excel handlers
  async handleExcelImport(file) {
    try {
      this.showToast('Processing Excel template...', 'success');
      const result = await ExcelHandler.parseExcelFile(file);
      
      const errorLog = document.getElementById('excel-error-log');
      const errorList = document.getElementById('excel-error-list');
      
      if (result.errors && result.errors.length > 0) {
        errorLog.style.display = 'block';
        errorList.innerHTML = '';
        result.errors.forEach(err => {
          errorList.innerHTML += `<li>${err}</li>`;
        });
        this.showToast('Some errors detected in XLSX rows.', 'error');
      } else {
        errorLog.style.display = 'none';
      }

      if (result.items && result.items.length > 0) {
        this.cargoItems = [...this.cargoItems, ...result.items];
        this.showToast(`Imported ${result.items.length} cargo items successfully!`, 'success');
        this.renderBuilderCargoTable();
      }
    } catch (err) {
      console.error(err);
      this.showToast('Excel parsing failed. Format incorrect.', 'error');
    }
  }

  // DB saves
  async saveDraftShipment() {
    if (this.cargoItems.length === 0) {
      this.showToast('Cannot save empty shipment draft. Add cargo items.', 'warning');
      return;
    }

    const customerVal = document.getElementById('builder-customer').value;
    const notesVal = document.getElementById('builder-notes').value;
    const autoRec = document.getElementById('builder-auto-recommend').checked;
    const targetPresetId = document.getElementById('builder-container-preset').value;
    const targetPreset = this.containersList.find(c => c.id === parseInt(targetPresetId));

    const dbId = document.getElementById('builder-db-id').value;
    if (dbId) {
      this.currentShipment.id = parseInt(dbId);
    }

    this.currentShipment.customerId = customerVal;
    this.currentShipment.notes = notesVal;
    this.currentShipment.autoRecommend = autoRec;
    this.currentShipment.status = 'Draft';
    this.currentShipment.date = new Date().toISOString();
    this.currentShipment.recommendedContainer = targetPreset ? targetPreset.name : '20GP';
    
    // Quick estimation for draft
    let totalCbm = 0;
    let totalWeight = 0;
    this.cargoItems.forEach(i => {
      totalCbm += (i.length * i.width * i.height) * i.quantity;
      totalWeight += i.weight * i.quantity;
    });
    this.currentShipment.totalCbm = totalCbm;
    this.currentShipment.totalWeight = totalWeight;
    this.currentShipment.containerCount = 1;
    this.currentShipment.spaceUtilization = 0;
    this.currentShipment.weightUtilization = 0;

    await dbInstance.saveShipmentWithItems(this.currentShipment, this.cargoItems);
    this.showToast(`Draft Shipment ${this.currentShipment.shipmentId || ''} saved successfully.`, 'success');
    this.switchView('shipments');
  }

  // Run Packing optimization
  runOptimization() {
    if (this.cargoItems.length === 0) {
      this.showToast('Please add cargo items to run packing plan.', 'warning');
      return;
    }

    const autoRec = document.getElementById('builder-auto-recommend').checked;
    const targetPresetId = document.getElementById('builder-container-preset').value;
    const selectedPreset = this.containersList.find(c => c.id === parseInt(targetPresetId)) || this.containersList[0];

    this.showToast('Starting 3D loading optimization engine...', 'success');
    
    // Call packing optimization engine
    const packingResult = PackingEngine.optimize(
      this.cargoItems,
      selectedPreset,
      this.containersList,
      autoRec
    );

    this.activePackingResult = packingResult;
    this.showToast('Optimization complete. Rendering 3D canvas...', 'success');
    this.switchView('results');
    this.setupResultsView();
  }

  // 4. Results View Controller
  setupResultsView() {
    const res = this.activePackingResult;
    if (!res) return;

    // Draw parameters on UI
    // Volume Space Util
    const primaryContainer = res.containers[0];
    const spaceUtil = primaryContainer ? primaryContainer.spaceUtilization : 0;
    const weightUtil = primaryContainer ? primaryContainer.weightUtilization : 0;
    const containerCount = res.totalContainersRequired || 1;
    
    document.getElementById('res-space-util').innerText = `${spaceUtil}%`;
    document.getElementById('res-box-name').innerText = `${res.container.name} Container`;
    document.getElementById('res-box-count').innerText = containerCount;
    
    // Aggregates
    let totalCbm = 0;
    let totalWeight = 0;
    res.containers.forEach(c => {
      totalCbm += c.totalCbm;
      totalWeight += c.totalWeight;
    });

    const singleContainerVol = res.container.length * res.container.width * res.container.height;
    const emptyVol = (singleContainerVol * containerCount) - totalCbm;

    document.getElementById('res-total-cbm').innerText = `${totalCbm.toFixed(2)} CBM`;
    document.getElementById('res-total-weight').innerText = `${totalWeight.toFixed(1)} kg`;
    document.getElementById('res-weight-util').innerText = `${weightUtil}%`;
    document.getElementById('res-empty-cbm').innerText = `${Math.max(0, emptyVol).toFixed(2)} CBM`;

    document.getElementById('results-container-sub').innerText = `3D View: Packed container 1 of ${containerCount}`;

    // Initialize/Render 3D Container Planner Canvas
    const canvasMount = document.getElementById('visualizer-canvas-mount');
    const tooltip = document.getElementById('visualizer-tooltip-div');
    
    // Cleanup previous visualizer
    if (this.visualizer) {
      this.visualizer.dispose();
    }

    // Mount canvas visualizer
    this.visualizer = new ContainerVisualizer(canvasMount, tooltip);
    
    // Draw packed items of container 1
    if (primaryContainer) {
      this.visualizer.renderPlan(res.container, primaryContainer.packedItems);
    }
  }

  async saveAndCloseResults() {
    const res = this.activePackingResult;
    if (!res) return;

    // Check builder UI parameters
    const customerVal = document.getElementById('builder-customer').value;
    const notesVal = document.getElementById('builder-notes').value;
    const autoRec = document.getElementById('builder-auto-recommend').checked;

    const dbId = document.getElementById('builder-db-id').value;
    if (dbId) {
      this.currentShipment.id = parseInt(dbId);
    }

    // Aggregates
    let totalCbm = 0;
    let totalWeight = 0;
    res.containers.forEach(c => {
      totalCbm += c.totalCbm;
      totalWeight += c.totalWeight;
    });

    const primaryContainer = res.containers[0];

    this.currentShipment.customerId = customerVal;
    this.currentShipment.notes = notesVal;
    this.currentShipment.autoRecommend = autoRec;
    this.currentShipment.status = 'Completed';
    this.currentShipment.date = new Date().toISOString();
    this.currentShipment.recommendedContainer = res.container.name;
    this.currentShipment.containerCount = res.totalContainersRequired;
    this.currentShipment.totalCbm = totalCbm;
    this.currentShipment.totalWeight = totalWeight;
    this.currentShipment.spaceUtilization = primaryContainer ? primaryContainer.spaceUtilization : 0;
    this.currentShipment.weightUtilization = primaryContainer ? primaryContainer.weightUtilization : 0;

    await dbInstance.saveShipmentWithItems(this.currentShipment, this.cargoItems);
    
    // Trigger PWA Push Notification Simulation
    this.triggerPushNotification(
      'Optimal Container Plan Generated',
      `Shipment ${this.currentShipment.shipmentId} optimized successfully using ${this.currentShipment.containerCount}x ${this.currentShipment.recommendedContainer} container(s) at ${this.currentShipment.spaceUtilization}% loading density.`
    );

    this.showToast('Load plan saved successfully.', 'success');
    this.switchView('dashboard');
  }

  // Simulating PWA notifications
  triggerPushNotification(title, message) {
    if (!('Notification' in window)) return;

    const pushEnabled = document.getElementById('set-pwa-push').checked;
    if (!pushEnabled) return;

    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: message,
        icon: 'assets/icons/icon-192x192.png'
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, {
            body: message,
            icon: 'assets/icons/icon-192x192.png'
          });
        }
      });
    }
  }

  // 5. Container preset library view controller
  async setupContainersView() {
    this.containersList = await dbInstance.getAll('containers');
    const containerGrid = document.getElementById('container-library-grid');
    containerGrid.innerHTML = '';

    this.containersList.forEach(c => {
      const card = document.createElement('div');
      card.className = 'shipment-card';
      card.innerHTML = `
        <div class="shipment-card-header">
          <div>
            <h4 class="shipment-card-title">${c.name} Presets</h4>
            <span class="shipment-card-date">${c.description || 'Custom shipping container'}</span>
          </div>
          <span class="badge badge-completed">Preset</span>
        </div>
        
        <div class="shipment-card-stats" style="grid-template-columns: repeat(2, 1fr);">
          <div>
            <span class="shipment-stat-label">Internal Dims</span>
            <span class="shipment-stat-val">${c.length} x ${c.width} x ${c.height} m</span>
          </div>
          <div>
            <span class="shipment-stat-label">Gross Vol</span>
            <span class="shipment-stat-val">${c.volume} CBM</span>
          </div>
          <div>
            <span class="shipment-stat-label">Max Payload</span>
            <span class="shipment-stat-val">${c.maxPayload} kg</span>
          </div>
          <div>
            <span class="shipment-stat-label">Door Dims</span>
            <span class="shipment-stat-val">${c.doorWidth} x ${c.doorHeight} m</span>
          </div>
        </div>

        <div class="shipment-card-actions">
          <button class="btn btn-outline btn-danger" onclick="app.deleteContainer(${c.id})" ${c.id <= 4 ? 'disabled' : ''}>
            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
            <span>Delete Preset</span>
          </button>
        </div>
      `;
      containerGrid.appendChild(card);
    });

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  async saveCustomContainer(containerData) {
    await dbInstance.add('containers', containerData);
    this.showToast(`Custom preset ${containerData.name} saved.`, 'success');
    this.setupContainersView();
  }

  async deleteContainer(id) {
    if (confirm('Delete this container preset?')) {
      await dbInstance.delete('containers', id);
      this.showToast('Container preset removed.', 'warning');
      this.setupContainersView();
    }
  }

  // 6. Customer Database
  async setupCustomersView() {
    this.customersList = await dbInstance.getAll('customers');
    const tbody = document.querySelector('#customers-full-table tbody');
    tbody.innerHTML = '';

    this.customersList.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;">${c.name}</td>
        <td><span class="badge ${c.type === 'Shipper' ? 'badge-completed' : 'badge-warning'}">${c.type}</span></td>
        <td>${c.contactPerson}</td>
        <td>${c.email}</td>
        <td>${c.phone}</td>
        <td style="font-size:11px; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.address}</td>
        <td>
          <button class="btn btn-outline btn-icon btn-icon-danger" onclick="app.deleteCustomer(${c.id})" title="Delete Profile"><i data-lucide="trash-2"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  async saveCustomerProfile(cust) {
    await dbInstance.add('customers', cust);
    this.showToast(`Customer account ${cust.name} added.`, 'success');
    this.setupCustomersView();
  }

  async deleteCustomer(id) {
    if (confirm('Delete this customer account profile?')) {
      await dbInstance.delete('customers', id);
      this.showToast('Customer profile deleted.', 'warning');
      this.setupCustomersView();
    }
  }

  // 7. Users Database View
  async setupUsersView() {
    this.usersList = await dbInstance.getAll('users');
    const tbody = document.querySelector('#users-full-table tbody');
    tbody.innerHTML = '';

    this.usersList.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;">${u.name}</td>
        <td>${u.username}</td>
        <td>${u.email}</td>
        <td><span class="badge badge-completed" style="background-color:var(--primary-pale); color:var(--primary-dark);">${u.role}</span></td>
        <td><span class="badge badge-completed">Active</span></td>
      `;
      tbody.appendChild(tr);
    });

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  async saveSystemUser(user) {
    await dbInstance.add('users', user);
    this.showToast(`User ${user.name} created.`, 'success');
    this.setupUsersView();
  }

  // 8. Settings Config
  async setupSettingsView() {
    // Loaded branding configs
    const companyName = this.settings.companyName || 'Right Logistics Pvt. Ltd.';
    const companyEmail = this.settings.companyEmail || 'planning@rightlogistics.com';
    const companyPhone = this.settings.companyPhone || '+91 22 6789 0000';
    const companyAddress = this.settings.companyAddress || '701, BKC, Mumbai';
    const defPresetId = this.settings.defaultContainerId || 1;

    document.getElementById('set-company-name').value = companyName;
    document.getElementById('set-company-email').value = companyEmail;
    document.getElementById('set-company-phone').value = companyPhone;
    document.getElementById('set-company-address').value = companyAddress;

    // Load defaults presets into settings selection
    const defaultSelect = document.getElementById('set-default-container');
    defaultSelect.innerHTML = '';
    this.containersList.forEach(c => {
      defaultSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
    defaultSelect.value = defPresetId;
  }

  async saveBrandingDetails(name, email, phone, address) {
    await dbInstance.put('settings', { key: 'companyName', value: name });
    await dbInstance.put('settings', { key: 'companyEmail', value: email });
    await dbInstance.put('settings', { key: 'companyPhone', value: phone });
    await dbInstance.put('settings', { key: 'companyAddress', value: address });
    
    // Reload local settings state
    await this.loadAppConfigs();
    this.showToast('Company branding profile updated.', 'success');
  }

  async savePreferencesDetails(defaultId) {
    await dbInstance.put('settings', { key: 'defaultContainerId', value: parseInt(defaultId) });
    
    await this.loadAppConfigs();
    this.showToast('Preferences updated successfully.', 'success');
  }

  // --- CRUD ACTIONS TRIGGERED OUTSIDE VIEWS ---

  async editShipment(id) {
    await this.switchView('shipment-builder');
    this.setupShipmentBuilderView(id);
  }

  async deleteShipment(id) {
    if (confirm('Delete this shipment and all packing configurations?')) {
      await dbInstance.deleteShipmentWithItems(id);
      this.showToast('Shipment removed.', 'warning');
      
      if (this.currentView === 'dashboard') {
        this.setupDashboardView();
      } else {
        this.setupShipmentsView();
      }
    }
  }

  // --- PDF REPORT TRIGGERS ---

  downloadPDFReport() {
    const res = this.activePackingResult;
    if (!res || !this.currentShipment) {
      this.showToast('No active calculations available.', 'warning');
      return;
    }

    this.showToast('Compiling loading layouts to PDF...', 'success');
    
    const companyDetails = {
      companyName: this.settings.companyName,
      companyAddress: this.settings.companyAddress,
      companyEmail: this.settings.companyEmail,
      companyPhone: this.settings.companyPhone
    };

    PDFGenerator.generateReport(
      this.currentShipment,
      this.cargoItems,
      res,
      companyDetails
    );
  }

  downloadPackingList() {
    if (this.cargoItems.length === 0) {
      this.showToast('Packing list empty.', 'warning');
      return;
    }
    this.showToast('Downloading XLSX packing sheet...', 'success');
    ExcelHandler.downloadTemplate();
  }

  // --- NOTIFICATION & MODALS SYSTEM ---

  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'warning') icon = 'alert-triangle';
    if (type === 'error') icon = 'x-circle';

    toast.innerHTML = `
      <i data-lucide="${icon}" style="width:18px;height:18px;"></i>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    // Auto-remove toast after 4.5 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  openModal(modalId) {
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'flex';
    
    // Hide all modal cards first, show targeted
    overlay.querySelectorAll('.modal-card').forEach(m => m.style.display = 'none');
    document.getElementById(modalId).style.display = 'block';

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  closeModals() {
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'none';
    overlay.querySelectorAll('.modal-card').forEach(m => m.style.display = 'none');
  }

  // --- THEME MANAGEMENT ---

  initTheme() {
    const savedTheme = localStorage.getItem('rl_theme') || 'light';
    this.setTheme(savedTheme);
  }

  setTheme(theme) {
    this.activeTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rl_theme', theme);

    // Update toggle button icon and text
    const themeIcon = document.getElementById('theme-toggle-icon');
    if (themeIcon) {
      if (theme === 'dark') {
        themeIcon.setAttribute('data-lucide', 'sun');
      } else {
        themeIcon.setAttribute('data-lucide', 'moon');
      }
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    }

    // Adjust visualizer scene color
    if (this.currentView === 'results' && this.visualizer) {
      this.setupResultsView();
    }
  }

  toggleTheme() {
    const nextTheme = this.activeTheme === 'light' ? 'dark' : 'light';
    this.setTheme(nextTheme);
    this.showToast(`Switched to ${nextTheme} mode.`, 'success');
  }

  // --- BINDING EVENTS ---

  bindGlobalEvents() {
    // Theme Toggle Handler
    const themeToggle = document.getElementById('btn-theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    // 1. Sidebar Nav click Router
    document.querySelectorAll('.sidebar-menu .nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const target = e.currentTarget.getAttribute('data-target');
        this.switchView(target);
      });
    });

    // Logout
    document.getElementById('btn-logout-trigger').addEventListener('click', () => {
      localStorage.removeItem('rl_planner_session');
      this.currentUser = null;
      this.showAuthScreen();
      this.showToast('Secure sign out successful.', 'success');
    });

    // 2. Auth Login Form Submission
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const uVal = document.getElementById('username').value.trim();
      const pVal = document.getElementById('password').value.trim();
      
      // Get role picker simulation selection
      const activeRoleEl = document.querySelector('.role-option.active');
      const roleVal = activeRoleEl ? activeRoleEl.getAttribute('data-role') : 'Admin';

      // Load Users list to validate
      await this.loadAppConfigs();
      
      const user = this.usersList.find(u => u.username.toLowerCase() === uVal.toLowerCase());
      
      if (user && user.password === pVal) {
        // Authenticated! Update role if they simulated another one for debugging
        user.role = roleVal;
        
        localStorage.setItem('rl_planner_session', JSON.stringify(user));
        this.currentUser = user;
        
        this.showToast(`Welcome back, ${user.name}!`, 'success');
        this.showApplicationShell();
      } else {
        // Fallback user matching if they didn't match password but entered default username
        // Allows easy testing
        if (uVal && pVal === 'password') {
          const mockUser = {
            name: `${uVal.charAt(0).toUpperCase() + uVal.slice(1)} Operator`,
            username: uVal,
            role: roleVal,
            email: `${uVal}@rightlogistics.com`
          };
          localStorage.setItem('rl_planner_session', JSON.stringify(mockUser));
          this.currentUser = mockUser;
          this.showToast(`Logged in under test account: ${mockUser.name}`, 'success');
          this.showApplicationShell();
        } else {
          this.showToast('Invalid credentials. Password is "password".', 'error');
        }
      }
    });

    // Role Picker simulation options clicks
    document.querySelectorAll('.role-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        document.querySelectorAll('.role-option').forEach(o => o.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });

    // 3. Workspace Header quick actions
    document.getElementById('btn-quick-new-shipment').addEventListener('click', () => {
      this.switchView('shipment-builder');
      this.setupShipmentBuilderView();
    });

    // 4. Dashboard specific actions
    document.getElementById('btn-dashboard-view-all').addEventListener('click', () => {
      this.switchView('shipments');
    });
    document.getElementById('qa-new-plan').addEventListener('click', () => {
      this.switchView('shipment-builder');
      this.setupShipmentBuilderView();
    });
    document.getElementById('qa-download-template').addEventListener('click', () => {
      this.downloadPackingList();
    });
    document.getElementById('qa-check-containers').addEventListener('click', () => {
      this.switchView('containers');
    });
    document.getElementById('qa-settings').addEventListener('click', () => {
      this.switchView('settings');
    });

    // 5. Shipments Filter & Searches
    document.getElementById('shipment-search-input').addEventListener('input', () => {
      this.setupShipmentsView();
    });
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.shipmentsFilter = e.currentTarget.getAttribute('data-filter');
        this.setupShipmentsView();
      });
    });

    // Cards/Tables view toggle
    document.getElementById('view-toggle-card').addEventListener('click', (e) => {
      document.getElementById('view-toggle-card').classList.add('active');
      document.getElementById('view-toggle-table').classList.remove('active');
      this.shipmentsViewMode = 'card';
      this.setupShipmentsView();
    });
    document.getElementById('view-toggle-table').addEventListener('click', (e) => {
      document.getElementById('view-toggle-card').classList.remove('active');
      document.getElementById('view-toggle-table').classList.add('active');
      this.shipmentsViewMode = 'table';
      this.setupShipmentsView();
    });

    // 6. Shipment Builder Events
    document.getElementById('btn-builder-download-template').addEventListener('click', () => {
      this.downloadPackingList();
    });

    // Excel sheet uploader parser
    document.getElementById('excel-file-uploader').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleExcelImport(file);
      }
    });

    // Single item manual entry form
    document.getElementById('cargo-entry-form').addEventListener('submit', (e) => {
      e.preventDefault();
      
      const item = {
        name: document.getElementById('cargo-name').value.trim(),
        type: document.getElementById('cargo-type').value,
        quantity: parseInt(document.getElementById('cargo-qty').value),
        weight: parseFloat(document.getElementById('cargo-weight').value),
        length: parseFloat(document.getElementById('cargo-length').value),
        width: parseFloat(document.getElementById('cargo-width').value),
        height: parseFloat(document.getElementById('cargo-height').value),
        stackable: document.getElementById('cargo-stackable').value,
        tiltable: document.getElementById('cargo-tiltable').value,
        notes: document.getElementById('cargo-notes').value.trim()
      };

      this.saveCargoItem(item);
    });

    // Save as draft button
    document.getElementById('btn-builder-save-draft').addEventListener('click', () => {
      this.saveDraftShipment();
    });

    // Optimize engine trigger button
    document.getElementById('btn-builder-run-packing').addEventListener('click', () => {
      this.runOptimization();
    });

    // 7. Results Screen View handlers
    document.getElementById('btn-results-back').addEventListener('click', () => {
      this.switchView('shipment-builder');
    });
    document.getElementById('btn-results-save-complete').addEventListener('click', () => {
      this.saveAndCloseResults();
    });
    document.getElementById('btn-results-download-pdf').addEventListener('click', () => {
      this.downloadPDFReport();
    });
    document.getElementById('btn-results-download-list').addEventListener('click', () => {
      this.downloadPackingList();
    });

    // Camera view triggers
    document.getElementById('btn-cam-perspective').addEventListener('click', () => {
      if (this.visualizer) this.visualizer.setViewAngle('perspective');
    });
    document.getElementById('btn-cam-top').addEventListener('click', () => {
      if (this.visualizer) this.visualizer.setViewAngle('top');
    });
    document.getElementById('btn-cam-side').addEventListener('click', () => {
      if (this.visualizer) this.visualizer.setViewAngle('side');
    });
    document.getElementById('btn-cam-front').addEventListener('click', () => {
      if (this.visualizer) this.visualizer.setViewAngle('front');
    });

    // 8. Modals forms overlays
    // Generic overlays close
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') {
        this.closeModals();
      }
    });
    document.querySelectorAll('.modal-close').forEach(c => {
      c.addEventListener('click', () => this.closeModals());
    });

    // Custom Container catalog modal
    document.getElementById('btn-add-custom-container').addEventListener('click', () => {
      this.openModal('modal-custom-container');
    });
    document.getElementById('modal-container-form').addEventListener('submit', (e) => {
      e.preventDefault();
      
      const cont = {
        name: document.getElementById('mc-name').value.trim(),
        length: parseFloat(document.getElementById('mc-length').value),
        width: parseFloat(document.getElementById('mc-width').value),
        height: parseFloat(document.getElementById('mc-height').value),
        maxPayload: parseFloat(document.getElementById('mc-payload').value),
        doorWidth: parseFloat(document.getElementById('mc-door-w').value),
        doorHeight: parseFloat(document.getElementById('mc-door-h').value),
        volume: parseFloat(document.getElementById('mc-volume').value),
        description: 'Custom logistics container unit'
      };

      this.saveCustomContainer(cont);
      this.closeModals();
      document.getElementById('modal-container-form').reset();
    });

    // Custom Customer profile modal
    document.getElementById('btn-add-customer-modal-trigger').addEventListener('click', () => {
      this.openModal('modal-custom-customer');
    });
    document.getElementById('modal-customer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      
      const cust = {
        name: document.getElementById('cust-name').value.trim(),
        type: document.getElementById('cust-type').value,
        contactPerson: document.getElementById('cust-contact').value.trim(),
        email: document.getElementById('cust-email').value.trim(),
        phone: document.getElementById('cust-phone').value.trim(),
        address: document.getElementById('cust-address').value.trim()
      };

      this.saveCustomerProfile(cust);
      this.closeModals();
      document.getElementById('modal-customer-form').reset();
    });

    // Register User modal
    document.getElementById('btn-add-user-modal-trigger').addEventListener('click', () => {
      this.openModal('modal-custom-user');
    });
    document.getElementById('modal-user-form').addEventListener('submit', (e) => {
      e.preventDefault();

      const user = {
        name: document.getElementById('us-name').value.trim(),
        username: document.getElementById('us-username').value.trim(),
        role: document.getElementById('us-role').value,
        email: document.getElementById('us-email').value.trim(),
        password: document.getElementById('us-password').value
      };

      this.saveSystemUser(user);
      this.closeModals();
      document.getElementById('modal-user-form').reset();
    });

    // Settings Submit
    document.getElementById('settings-branding-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = document.getElementById('set-company-name').value.trim();
      const em = document.getElementById('set-company-email').value.trim();
      const p = document.getElementById('set-company-phone').value.trim();
      const ad = document.getElementById('set-company-address').value.trim();
      this.saveBrandingDetails(n, em, p, ad);
    });

    document.getElementById('settings-preferences-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const defaultId = document.getElementById('set-default-container').value;
      this.savePreferencesDetails(defaultId);
    });
  }
}

// Start core app instance
const app = new AppController();
window.app = app;

window.addEventListener('DOMContentLoaded', () => {
  app.start();
});
