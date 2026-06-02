/**
 * Right Loading Planner - Excel Template Download & Import Handler
 * Utilizes SheetJS (XLSX) to process cargo listings.
 */

class ExcelHandler {
  /**
   * Generates and downloads a clean Excel template prefilled with sample rows
   */
  static downloadTemplate() {
    if (typeof XLSX === 'undefined') {
      alert('Excel library not loaded. Please verify your connection.');
      return;
    }

    const headers = [
      ['Item Name', 'Item Type', 'Length (m)', 'Width (m)', 'Height (m)', 'Weight (kg)', 'Quantity', 'Stackable (Yes/No)', 'Tiltable (Yes/No)', 'Notes']
    ];

    const samples = [
      ['Standard Carton A', 'Cartons', 0.5, 0.4, 0.3, 12, 100, 'Yes', 'No', 'Fragile electronic parts'],
      ['Heavy Wooden Crate', 'Crates', 1.2, 1.0, 0.8, 250, 4, 'Yes', 'No', 'Industrial machinery component'],
      ['Plastic Barrel B', 'Barrels', 0.6, 0.6, 0.9, 85, 12, 'No', 'No', 'Liquid raw materials'],
      ['Steel Pipes Bundle', 'Pipes', 3.0, 0.3, 0.3, 110, 8, 'Yes', 'Yes', 'Structural tubes'],
      ['Standard Pallet Pack', 'Pallets', 1.2, 0.8, 1.4, 180, 10, 'Yes', 'No', 'Retail store inventory'],
      ['Delicate Equipment', 'Machinery', 1.5, 1.2, 1.1, 450, 1, 'No', 'No', 'Do not double stack']
    ];

    const data = [...headers, ...samples];

    // Create sheet
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 22 }, // Item Name
      { wch: 12 }, // Item Type
      { wch: 12 }, // Length
      { wch: 12 }, // Width
      { wch: 12 }, // Height
      { wch: 12 }, // Weight
      { wch: 10 }, // Quantity
      { wch: 18 }, // Stackable
      { wch: 18 }, // Tiltable
      { wch: 25 }  // Notes
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cargo Entry Template');

    // Trigger download
    XLSX.writeFile(wb, 'Right_Logistics_Cargo_Template.xlsx');
  }

  /**
   * Parse uploaded Excel file and validate fields
   * @param {File} file - Browser File object
   * @returns {Promise<Object>} - Resolves with { items: Array, errors: Array }
   */
  static parseExcelFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') {
        reject(new Error('Excel library (SheetJS) is not loaded.'));
        return;
      }

      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Convert sheet to JSON array
          const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          if (rawRows.length < 2) {
            resolve({ items: [], errors: ['Uploaded file is empty or missing data rows.'] });
            return;
          }

          const parsedItems = [];
          const validationErrors = [];
          const validTypes = ['Cartons', 'Crates', 'Pallets', 'Pipes', 'Barrels', 'Machinery'];

          // Raw headers (first row)
          const fileHeaders = rawRows[0].map(h => String(h).trim().toLowerCase());

          // Search header indices
          const getIndex = (names) => fileHeaders.findIndex(h => names.some(n => h.includes(n)));
          const nameIdx = getIndex(['item name', 'name', 'title']);
          const typeIdx = getIndex(['type', 'cargo type', 'item type']);
          const lenIdx = getIndex(['length', 'len', 'l (m)', 'length (m)']);
          const widIdx = getIndex(['width', 'wid', 'w (m)', 'width (m)']);
          const heiIdx = getIndex(['height', 'hei', 'h (m)', 'height (m)']);
          const weiIdx = getIndex(['weight', 'wgt', 'wt (kg)', 'weight (kg)']);
          const qtyIdx = getIndex(['quantity', 'qty', 'count']);
          const stackIdx = getIndex(['stackable', 'stack']);
          const tiltIdx = getIndex(['tiltable', 'tilt']);
          const notesIdx = getIndex(['notes', 'note', 'comment']);

          // Parse each data row
          for (let r = 1; r < rawRows.length; r++) {
            const row = rawRows[r];
            if (!row || row.length === 0 || row.every(val => val === null || val === '')) {
              continue; // Skip empty rows
            }

            const rowNum = r + 1;
            const itemName = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : `Item-${rowNum}`;
            let itemType = typeIdx !== -1 && row[typeIdx] ? String(row[typeIdx]).trim() : 'Cartons';
            
            // Validate Cargo Type
            // Standardize case to match our options
            const matchedType = validTypes.find(t => t.toLowerCase() === itemType.toLowerCase());
            if (!matchedType) {
              validationErrors.push(`Row ${rowNum}: Invalid Cargo Type "${itemType}". Allowed: ${validTypes.join(', ')}.`);
              itemType = 'Cartons'; // Fallback
            } else {
              itemType = matchedType;
            }

            // Numeric parsing
            const length = lenIdx !== -1 ? parseFloat(row[lenIdx]) : 0;
            const width = widIdx !== -1 ? parseFloat(row[widIdx]) : 0;
            const height = heiIdx !== -1 ? parseFloat(row[heiIdx]) : 0;
            const weight = weiIdx !== -1 ? parseFloat(row[weiIdx]) : 0;
            const quantity = qtyIdx !== -1 ? parseInt(row[qtyIdx]) : 1;

            // Dimensions validation
            if (isNaN(length) || length <= 0) validationErrors.push(`Row ${rowNum}: Length must be a positive number.`);
            if (isNaN(width) || width <= 0) validationErrors.push(`Row ${rowNum}: Width must be a positive number.`);
            if (isNaN(height) || height <= 0) validationErrors.push(`Row ${rowNum}: Height must be a positive number.`);
            if (isNaN(weight) || weight < 0) validationErrors.push(`Row ${rowNum}: Weight must be a non-negative number.`);
            if (isNaN(quantity) || quantity <= 0) validationErrors.push(`Row ${rowNum}: Quantity must be at least 1.`);

            // Boolean settings
            const getBool = (val) => {
              if (!val) return 'No';
              const cleanVal = String(val).trim().toLowerCase();
              return (cleanVal === 'yes' || cleanVal === 'true' || cleanVal === 'y' || cleanVal === '1') ? 'Yes' : 'No';
            };

            const stackable = stackIdx !== -1 ? getBool(row[stackIdx]) : 'Yes';
            const tiltable = tiltIdx !== -1 ? getBool(row[tiltIdx]) : 'No';
            const notes = notesIdx !== -1 && row[notesIdx] ? String(row[notesIdx]).trim() : '';

            parsedItems.push({
              name: itemName,
              type: itemType,
              length: length || 0.1,
              width: width || 0.1,
              height: height || 0.1,
              weight: weight || 0,
              quantity: quantity || 1,
              stackable: stackable,
              tiltable: tiltable,
              notes: notes
            });
          }

          resolve({ items: parsedItems, errors: validationErrors });
        } catch (err) {
          console.error(err);
          reject(err);
        }
      };

      reader.onerror = (err) => {
        reject(err);
      };

      reader.readAsArrayBuffer(file);
    });
  }
}

window.ExcelHandler = ExcelHandler;
