/**
 * Right Loading Planner - IndexedDB Interface
 * Native, lightweight client-side database wrapper.
 */

class RightLoadingDB {
  constructor() {
    this.dbName = 'RightLoadingPlannerDB';
    this.dbVersion = 1;
    this.db = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (e) => {
        console.error('Database failed to open', e);
        reject(e);
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Users Store
        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
          userStore.createIndex('username', 'username', { unique: true });
        }

        // Customers Store
        if (!db.objectStoreNames.contains('customers')) {
          db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
        }

        // Shipments Store
        if (!db.objectStoreNames.contains('shipments')) {
          const shipmentStore = db.createObjectStore('shipments', { keyPath: 'id', autoIncrement: true });
          shipmentStore.createIndex('shipmentId', 'shipmentId', { unique: true });
        }

        // Cargo Items Store (linked to shipments)
        if (!db.objectStoreNames.contains('cargoItems')) {
          const cargoStore = db.createObjectStore('cargoItems', { keyPath: 'id', autoIncrement: true });
          cargoStore.createIndex('shipmentId', 'shipmentId', { unique: false });
        }

        // Preset Containers Store
        if (!db.objectStoreNames.contains('containers')) {
          const containerStore = db.createObjectStore('containers', { keyPath: 'id', autoIncrement: true });
          containerStore.createIndex('name', 'name', { unique: true });
        }

        // Settings Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  // Generic helper for transaction execution
  _executeTransaction(storeName, mode, callback) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      
      let request;
      try {
        request = callback(store);
      } catch (err) {
        reject(err);
        return;
      }

      transaction.oncomplete = () => {
        resolve(request ? request.result : null);
      };

      transaction.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  // --- PRESETS INITIALIZATION ---
  async loadPresetsIfNeeded() {
    const users = await this.getAll('users');
    if (users.length === 0) {
      console.log('Database empty, inserting default presets...');
      await this.insertPresets();
    }
  }

  async insertPresets() {
    // 1. Add Users (Admin, Operations, Sales, Customer)
    const defaultUsers = [
      { name: 'Admin User', username: 'admin', password: 'password', role: 'Admin', email: 'admin@rightlogistics.com' },
      { name: 'Operations Executive', username: 'ops', password: 'password', role: 'Operations', email: 'ops@rightlogistics.com' },
      { name: 'Sales Representative', username: 'sales', password: 'password', role: 'Sales', email: 'sales@rightlogistics.com' },
      { name: 'Client Account', username: 'customer', password: 'password', role: 'Customer', email: 'client@external.com' }
    ];
    for (const u of defaultUsers) {
      await this.add('users', u);
    }

    // 2. Add Default Container Preset Libraries
    // All dimensions in meters, volumes in CBM, weights in kg
    const defaultContainers = [
      { name: '20GP', length: 5.898, width: 2.352, height: 2.393, maxPayload: 28200, doorWidth: 2.343, doorHeight: 2.280, volume: 33.2, description: '20ft General Purpose' },
      { name: '40GP', length: 12.032, width: 2.352, height: 2.393, maxPayload: 28800, doorWidth: 2.343, doorHeight: 2.280, volume: 67.7, description: '40ft General Purpose' },
      { name: '40HC', length: 12.032, width: 2.352, height: 2.698, maxPayload: 28600, doorWidth: 2.343, doorHeight: 2.585, volume: 76.4, description: '40ft High Cube' },
      { name: '45HC', length: 13.556, width: 2.352, height: 2.698, maxPayload: 27700, doorWidth: 2.343, doorHeight: 2.585, volume: 86.0, description: '45ft High Cube' }
    ];
    for (const c of defaultContainers) {
      await this.add('containers', c);
    }

    // 3. Add Customers (Shipper/Consignee presets)
    const defaultCustomers = [
      { name: 'Apex Industries Ltd.', contactPerson: 'John Smith', email: 'jsmith@apex.com', phone: '+91 98765 43210', address: 'Plot 42, GIDC, Vadodara, India', type: 'Shipper' },
      { name: 'Global Logistics Corp', contactPerson: 'Jane Doe', email: 'operations@globallogistics.com', phone: '+1 (555) 019-2834', address: '100 Portway Blvd, New Jersey, USA', type: 'Consignee' },
      { name: 'Euro Distribution AG', contactPerson: 'Hans Mueller', email: 'hans@eurodist.de', phone: '+49 89 201938', address: 'Industriestrasse 12, Hamburg, Germany', type: 'Consignee' }
    ];
    for (const cust of defaultCustomers) {
      await this.add('customers', cust);
    }

    // 4. Default Settings
    const defaultSettings = [
      { key: 'companyName', value: 'Right Logistics Pvt. Ltd.' },
      { key: 'companyEmail', value: 'planning@rightlogistics.com' },
      { key: 'companyPhone', value: '+91 22 6789 0000' },
      { key: 'companyAddress', value: '701, Trade Center, Bandra Kurla Complex, Mumbai - 400051, India' },
      { key: 'unitPreference', value: 'metric' }, // metric (m/kg) or imperial (ft/lb)
      { key: 'defaultContainerId', value: 1 } // Default to 20GP
    ];
    for (const s of defaultSettings) {
      await this.put('settings', s);
    }
  }

  // --- CRUD METHODS ---

  getAll(storeName) {
    return this._executeTransaction(storeName, 'readonly', (store) => store.getAll());
  }

  getById(storeName, id) {
    return this._executeTransaction(storeName, 'readonly', (store) => store.get(id));
  }

  add(storeName, data) {
    return this._executeTransaction(storeName, 'readwrite', (store) => store.add(data));
  }

  put(storeName, data) {
    return this._executeTransaction(storeName, 'readwrite', (store) => store.put(data));
  }

  delete(storeName, id) {
    return this._executeTransaction(storeName, 'readwrite', (store) => store.delete(id));
  }

  // --- COMPLEX OBJECT CRUD ---

  async saveShipmentWithItems(shipment, cargoItems) {
    // Generate shipment code if not existing
    if (!shipment.shipmentId) {
      const year = new Date().getFullYear().toString().substring(2);
      const rand = Math.floor(1000 + Math.random() * 9000);
      shipment.shipmentId = `RL-PLN-${year}-${rand}`;
    }
    
    // Save shipment
    const shipmentIdDb = await this._executeTransaction('shipments', 'readwrite', (store) => store.put(shipment));
    const finalShipmentId = shipment.id || shipmentIdDb;
    
    // Delete existing cargo items for this shipment
    const allCargo = await this.getAll('cargoItems');
    for (const item of allCargo) {
      if (item.shipmentId === finalShipmentId) {
        await this.delete('cargoItems', item.id);
      }
    }

    // Insert new cargo items
    for (const item of cargoItems) {
      item.shipmentId = finalShipmentId;
      // Convert inputs to numbers
      item.length = parseFloat(item.length) || 0;
      item.width = parseFloat(item.width) || 0;
      item.height = parseFloat(item.height) || 0;
      item.weight = parseFloat(item.weight) || 0;
      item.quantity = parseInt(item.quantity) || 0;
      await this.add('cargoItems', item);
    }

    return finalShipmentId;
  }

  async getShipmentWithItems(id) {
    const shipment = await this.getById('shipments', id);
    if (!shipment) return null;

    const allCargo = await this.getAll('cargoItems');
    const cargoItems = allCargo.filter(item => item.shipmentId === id);

    return { shipment, cargoItems };
  }

  async deleteShipmentWithItems(id) {
    // Delete cargo items
    const allCargo = await this.getAll('cargoItems');
    for (const item of allCargo) {
      if (item.shipmentId === id) {
        await this.delete('cargoItems', item.id);
      }
    }
    // Delete shipment
    await this.delete('shipments', id);
    return true;
  }
}

// Global DB instance
const db = new RightLoadingDB();
window.dbInstance = db;
