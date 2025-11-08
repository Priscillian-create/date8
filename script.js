// Service Worker Registration
if ('serviceWorker' in navigator && !window.location.hostname.includes('stackblitz')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
} else if (window.location.hostname.includes('stackblitz')) {
    console.log('ServiceWorker registration skipped: Running in StackBlitz environment');
}

// Offline/Online Detection and Sync Management
const offlineIndicator = document.getElementById('offline-indicator');
const syncStatus = document.getElementById('sync-status');
const syncStatusText = document.getElementById('sync-status-text');
let isOnline = navigator.onLine;
let syncQueue = [];
let connectionRetryCount = 0;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 5000; // 5 seconds

// Initialize Supabase
const supabaseUrl = 'https://ieriphdzlbuzqqwrymwn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllcmlwaGR6bGJ1enFxd3J5bXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzMDU1MTgsImV4cCI6MjA3Nzg4MTUxOH0.bvbs6joSxf1u9U8SlaAYmjve-N6ArNYcNMtnG6-N_HU';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Connection retry logic with enhanced error handling
function checkSupabaseConnection() {
    if (!isOnline) {
        updateConnectionStatus('offline', 'Offline');
        return;
    }
    
    updateConnectionStatus('checking', 'Checking connection...');
    
    // Try a simple read operation to check connection
    supabase.from('products').select('count').limit(1)
        .then(() => {
            console.log('Supabase connection is working');
            connectionRetryCount = 0;
            updateConnectionStatus('online', 'Connected');
            
            // Process any pending sync operations
            if (syncQueue.length > 0) {
                processSyncQueue();
            }
        })
        .catch(error => {
            console.error('Supabase connection check failed:', error);
            updateConnectionStatus('offline', 'Connection failed');
            
            // Check if it's an RLS policy error
            if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                console.warn('Infinite recursion detected in database policies');
                showNotification('Database policy issue detected. Some features may be limited.', 'warning');
                return; // Don't retry for policy errors
            }
            
            if (connectionRetryCount < MAX_RETRY_ATTEMPTS) {
                connectionRetryCount++;
                console.log(`Retrying Supabase connection (${connectionRetryCount}/${MAX_RETRY_ATTEMPTS})...`);
                
                setTimeout(checkSupabaseConnection, RETRY_DELAY);
            } else {
                console.error('Max retry attempts reached. Supabase connection may be unavailable.');
                showNotification('Connection to database failed. Some features may be limited.', 'warning');
            }
        });
}

// Update connection status
function updateConnectionStatus(status, message) {
    const statusEl = document.getElementById('connection-status');
    const textEl = document.getElementById('connection-text');
    
    if (statusEl && textEl) {
        statusEl.className = 'connection-status ' + status;
        textEl.textContent = message;
    }
}

// PWA Install Prompt Setup
let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'flex';
});

installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
        installBtn.style.display = 'none';
    } else {
        console.log('User dismissed the install prompt');
    }
    deferredPrompt = null;
});

// Online/Offline Detection
window.addEventListener('online', () => {
    isOnline = true;
    offlineIndicator.classList.remove('show');
    showNotification('You are back online!', 'success');
    
    // Check Supabase connection and sync
    checkSupabaseConnection();
    
    // Force refresh all data when coming back online
    setTimeout(() => {
        refreshAllData();
    }, 1000);
});

window.addEventListener('offline', () => {
    isOnline = false;
    offlineIndicator.classList.add('show');
});

// Enhanced refreshAllData function
async function refreshAllData() {
    console.log('🔄 Refreshing all data after reconnection...');
    
    try {
        // Show sync status
        if (syncStatus) {
            syncStatus.classList.add('show', 'syncing');
            syncStatusText.textContent = 'Syncing all data...';
        }
        
        // Fetch fresh data from Supabase with error handling
        let newProducts = [];
        let newSales = [];
        let newDeletedSales = [];
        
        try {
            newProducts = await DataModule.fetchProducts();
        } catch (error) {
            console.error('Error fetching products:', error);
            newProducts = products; // Use existing data
        }
        
        try {
            newSales = await DataModule.fetchSales();
        } catch (error) {
            console.error('Error fetching sales:', error);
            newSales = sales; // Use existing data
        }
        
        try {
            newDeletedSales = await DataModule.fetchDeletedSales();
        } catch (error) {
            console.error('Error fetching deleted sales:', error);
            newDeletedSales = deletedSales; // Use existing data
        }
        
        // Update global variables
        products = newProducts;
        sales = newSales;
        deletedSales = newDeletedSales;
        
        // Validate sales data
        validateSalesData();
        
        // Save to localStorage
        saveToLocalStorage();
        
        // Refresh UI
        loadProducts();
        loadSales();
        
        if (currentPage === 'inventory') {
            loadInventory();
        } else if (currentPage === 'reports') {
            generateReport();
        } else if (currentPage === 'account') {
            loadAccount();
        }
        
        // Process any remaining sync queue
        if (syncQueue.length > 0) {
            await processSyncQueue();
        }
        
        if (syncStatus) {
            syncStatus.classList.remove('syncing');
            syncStatus.classList.add('show');
            syncStatusText.textContent = 'All data synced';
            setTimeout(() => syncStatus.classList.remove('show'), 3000);
        }
        
        showNotification('All data synchronized successfully!', 'success');
        
    } catch (error) {
        console.error('Error refreshing data:', error);
        
        if (syncStatus) {
            syncStatus.classList.remove('syncing');
            syncStatus.classList.add('error');
            syncStatusText.textContent = 'Sync error';
            setTimeout(() => syncStatus.classList.remove('show', 'error'), 3000);
        }
        
        showNotification('Error syncing data. Please try again.', 'error');
    }
}

// Improved addToSyncQueue() - better duplicate detection and offline handling
function addToSyncQueue(operation) {
    console.log('🔄 Adding to sync queue:', operation.type, operation.data?.id || operation.data?.receiptNumber);
    
    // Generate unique ID for operation if not present
    if (!operation.id) {
        operation.id = 'op_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    // Add timestamp
    operation.timestamp = new Date().toISOString();
    
    // For sales, check by receipt number instead of exact data match
    if (operation.type === 'saveSale') {
        const receiptNumber = operation.data.receiptNumber;
        
        // Check if this sale is already in the queue
        const existingIndex = syncQueue.findIndex(op => 
            op.type === 'saveSale' && 
            op.data.receiptNumber === receiptNumber
        );
        
        if (existingIndex !== -1) {
            console.log(`Sale with receipt ${receiptNumber} already in sync queue — updating`);
            syncQueue[existingIndex] = operation;
        } else {
            syncQueue.push(operation);
        }
    } else if (operation.type === 'saveProduct') {
        // For product stock updates, check if there's already a stock update for this product
        if (operation.data.stock !== undefined && !operation.data.name) {
            const existingIndex = syncQueue.findIndex(op => 
                op.type === 'saveProduct' && 
                op.data.id === operation.data.id && 
                op.data.stock !== undefined
            );
            
            if (existingIndex !== -1) {
                // Update the existing stock update with the new value
                syncQueue[existingIndex].data.stock = operation.data.stock;
                console.log(`Updated existing stock update for product ${operation.data.id}`);
            } else {
                syncQueue.push(operation);
            }
        } else {
            // For other operations, check for duplicates
            const existingIndex = syncQueue.findIndex(op => 
                op.type === operation.type && 
                op.data.id === operation.data.id
            );
            
            if (existingIndex !== -1) {
                syncQueue[existingIndex] = operation;
            } else {
                syncQueue.push(operation);
            }
        }
    } else {
        // For other operations, check for duplicates
        const existingIndex = syncQueue.findIndex(op => 
            op.type === operation.type && 
            op.id === operation.id
        );
        
        if (existingIndex !== -1) {
            syncQueue[existingIndex] = operation;
        } else {
            syncQueue.push(operation);
        }
    }
    
    // Save to localStorage
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    
    if (isOnline) {
        // Process immediately if online
        processSyncQueue();
    } else {
        showNotification('Offline: Operation saved locally and will sync automatically.', 'info');
    }
}

// Improved processSyncQueue() - better error handling and retry logic
async function processSyncQueue() {
    if (syncQueue.length === 0) {
        console.log('✅ Sync queue is empty');
        return;
    }
    
    console.log(`🔄 Processing sync queue with ${syncQueue.length} operations`);
    
    syncStatus.classList.add('show', 'syncing');
    syncStatusText.textContent = `Syncing ${syncQueue.length} operations...`;
    
    // Sort operations by timestamp (oldest first)
    syncQueue.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Process operations one by one
    for (let i = 0; i < syncQueue.length; i++) {
        const operation = syncQueue[i];
        
        if (operation.synced) {
            continue;
        }
        
        console.log(`🔄 Processing operation ${i + 1}/${syncQueue.length}:`, operation.type);
        
        try {
            let success = false;
            
            if (operation.type === 'saveSale') {
                success = await syncSale(operation);
            } else if (operation.type === 'saveProduct') {
                success = await syncProduct(operation);
            } else if (operation.type === 'deleteProduct') {
                success = await syncDeleteProduct(operation);
            } else if (operation.type === 'deleteSale') {
                success = await syncDeleteSale(operation);
            }
            
            if (success) {
                operation.synced = true;
                operation.syncedAt = new Date().toISOString();
                console.log(`✅ Successfully synced operation:`, operation.type);
            } else {
                console.warn(`⚠️ Failed to sync operation:`, operation.type);
                // Don't mark as synced, will retry
            }
        } catch (error) {
            console.error(`❌ Error syncing operation:`, operation.type, error);
            // Don't mark as synced, will retry
        }
        
        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Save updated sync queue
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    
    // Remove synced operations
    const originalLength = syncQueue.length;
    syncQueue = syncQueue.filter(op => !op.synced);
    
    if (syncQueue.length < originalLength) {
        localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
        console.log(`🗑️ Removed ${originalLength - syncQueue.length} synced operations from queue`);
    }
    
    // Update UI
    if (syncQueue.length === 0) {
        syncStatus.classList.remove('syncing');
        syncStatus.classList.add('show');
        syncStatusText.textContent = 'All data synced';
        setTimeout(() => syncStatus.classList.remove('show'), 3000);
        
        // Refresh data after successful sync
        await refreshAllData();
    } else {
        syncStatus.classList.remove('syncing');
        syncStatus.classList.add('error');
        syncStatusText.textContent = `${syncQueue.length} operations pending`;
        setTimeout(() => syncStatus.classList.remove('show', 'error'), 3000);
    }
}

// Helper function to validate and fix user ID
async function ensureValidUserId(userId) {
    if (!userId) {
        console.error('No user ID provided');
        return null;
    }
    
    // Check if it's already a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(userId)) {
        // Check if this UUID exists in the users table
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (!error && data) {
                return userId; // Valid UUID that exists in users table
            }
        } catch (error) {
            console.error('Error checking user ID:', error);
        }
    }
    
    // If we get here, the user ID is not a valid UUID or doesn't exist in the users table
    console.warn('Invalid user ID or user not found in database:', userId);
    
    // Try to find the user by email if we have the current user
    if (currentUser && currentUser.email) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id')
                .eq('email', currentUser.email)
                .single();
            
            if (!error && data) {
                console.log('Found user by email, updating current user ID');
                currentUser.id = data.id;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                return data.id;
            }
        } catch (error) {
            console.error('Error finding user by email:', error);
        }
    }
    
    // If we still can't find a valid user ID, create a default user or use a fallback
    console.warn('Using fallback user ID');
    return '00000000-0000-0000-0000-000000000000'; // Default fallback UUID
}

// Individual sync functions for better error handling
async function syncSale(operation) {
    try {
        // Ensure we have a valid cashierId
        const validCashierId = await ensureValidUserId(operation.data.cashierId);
        
        if (!validCashierId) {
            console.error('Cannot sync sale: No valid cashier ID');
            return false;
        }
        
        // Update the operation data with the valid cashierId
        operation.data.cashierId = validCashierId;
        
        // Check if sale already exists by receipt number
        const { data: existingSales, error: fetchError } = await supabase
            .from('sales')
            .select('*')
            .eq('receiptNumber', operation.data.receiptNumber);
        
        if (fetchError) {
            throw fetchError;
        }
        
        if (!existingSales || existingSales.length === 0) {
            // Sale doesn't exist, add it to Supabase
            const { data, error } = await supabase
                .from('sales')
                .insert(operation.data)
                .select();
            
            if (error) {
                throw error;
            }
            
            if (data && data.length > 0) {
                // Update the local sale with the Supabase ID
                const localSaleIndex = sales.findIndex(s => s.receiptNumber === operation.data.receiptNumber);
                if (localSaleIndex !== -1) {
                    sales[localSaleIndex].id = data[0].id;
                    sales[localSaleIndex].cashierId = validCashierId; // Update with valid ID
                    saveToLocalStorage();
                }
                return true;
            }
        } else {
            console.log(`Sale with receipt ${operation.data.receiptNumber} already exists`);
            // Update the local sale with the Supabase ID
            if (existingSales.length > 0) {
                const localSaleIndex = sales.findIndex(s => s.receiptNumber === operation.data.receiptNumber);
                if (localSaleIndex !== -1) {
                    sales[localSaleIndex].id = existingSales[0].id;
                    sales[localSaleIndex].cashierId = validCashierId; // Update with valid ID
                    saveToLocalStorage();
                }
            }
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error syncing sale:', error);
        return false;
    }
}

async function syncProduct(operation) {
    try {
        if (operation.data.stock !== undefined && !operation.data.name) {
            // This is a stock update
            const { error } = await supabase
                .from('products')
                .update({ stock: operation.data.stock })
                .eq('id', operation.data.id);
            
            if (error) {
                throw error;
            }
        } else {
            // This is a full product save
            if (operation.data.id && !operation.data.id.startsWith('temp_')) {
                // Update existing product
                const { error } = await supabase
                    .from('products')
                    .update(operation.data)
                    .eq('id', operation.data.id);
                
                if (error) {
                    throw error;
                }
            } else {
                // Add new product
                const { data, error } = await supabase
                    .from('products')
                    .insert(operation.data)
                    .select();
                
                if (error) {
                    throw error;
                }
                
                if (data && data.length > 0) {
                    // Update local product with Supabase ID
                    const localProductIndex = products.findIndex(p => p.id === operation.data.id);
                    if (localProductIndex !== -1) {
                        products[localProductIndex].id = data[0].id;
                        saveToLocalStorage();
                    }
                }
            }
        }
        
        return true;
    } catch (error) {
        console.error('Error syncing product:', error);
        return false;
    }
}

async function syncDeleteProduct(operation) {
    try {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', operation.id);
        
        if (error) {
            throw error;
        }
        
        return true;
    } catch (error) {
        console.error('Error syncing product deletion:', error);
        return false;
    }
}

async function syncDeleteSale(operation) {
    try {
        // First, get the sale data
        const { data: saleData, error: fetchError } = await supabase
            .from('sales')
            .select('*')
            .eq('id', operation.id)
            .single();
        
        if (fetchError) {
            throw fetchError;
        }
        
        if (saleData) {
            // Add to deleted_sales table
            saleData.deleted = true;
            saleData.deletedAt = new Date().toISOString();
            
            const { error: insertError } = await supabase
                .from('deleted_sales')
                .insert(saleData);
            
            if (insertError) {
                throw insertError;
            }
            
            // Delete from sales table
            const { error: deleteError } = await supabase
                .from('sales')
                .delete()
                .eq('id', operation.id);
            
            if (deleteError) {
                throw deleteError;
            }
        }
        
        return true;
    } catch (error) {
        console.error('Error syncing sale deletion:', error);
        return false;
    }
}

// Load sync queue from localStorage on app start
function loadSyncQueue() {
    const savedQueue = localStorage.getItem('syncQueue');
    if (savedQueue) {
        try {
            syncQueue = JSON.parse(savedQueue);
            console.log(`📥 Loaded ${syncQueue.length} operations from sync queue`);
            
            // Clean up old operations (older than 7 days)
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            
            const originalLength = syncQueue.length;
            syncQueue = syncQueue.filter(op => {
                const opDate = new Date(op.timestamp || 0);
                return opDate > weekAgo;
            });
            
            if (syncQueue.length < originalLength) {
                console.log(`🗑️ Removed ${originalLength - syncQueue.length} old operations from sync queue`);
                localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
            }
        } catch (e) {
            console.error('Error parsing sync queue:', e);
            syncQueue = [];
        }
    }
}

// Clean up completed sync operations
function cleanupSyncQueue() {
    syncQueue = syncQueue.filter(op => !op.synced);
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
}

// Add function to clean up duplicate sales on app startup
function cleanupDuplicateSales() {
    const receiptNumbers = new Set();
    const uniqueSales = [];
    
    sales.forEach(sale => {
        if (!receiptNumbers.has(sale.receiptNumber)) {
            receiptNumbers.add(sale.receiptNumber);
            uniqueSales.push(sale);
        } else {
            console.log(`Removing duplicate sale with receipt: ${sale.receiptNumber}`);
        }
    });
    
    if (sales.length !== uniqueSales.length) {
        sales = uniqueSales;
        saveToLocalStorage();
        console.log(`Cleaned up ${sales.length - uniqueSales.length} duplicate sales`);
    }
}

// Add function to set up real-time listeners properly
function setupRealtimeListeners() {
    // Products listener
    if (isOnline) {
        supabase
            .channel('products-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
                console.log('Products change received:', payload);
                
                // Refresh products
                DataModule.fetchProducts().then(updatedProducts => {
                    products = updatedProducts;
                    saveToLocalStorage();
                    loadProducts();
                });
            })
            .subscribe();
        
        // Sales listener
        supabase
            .channel('sales-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, (payload) => {
                console.log('Sales change received:', payload);
                
                // Refresh sales
                DataModule.fetchSales().then(updatedSales => {
                    sales = updatedSales;
                    saveToLocalStorage();
                    loadSales();
                });
            })
            .subscribe();
        
        // Deleted sales listener
        supabase
            .channel('deleted-sales-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'deleted_sales' }, (payload) => {
                console.log('Deleted sales change received:', payload);
                
                // Refresh deleted sales
                DataModule.fetchDeletedSales().then(updatedDeletedSales => {
                    deletedSales = updatedDeletedSales;
                    saveToLocalStorage();
                    loadDeletedSales();
                });
            })
            .subscribe();
    }
}

// Data storage
let products = [];
let cart = [];
let sales = [];
let deletedSales = [];
let users = [];
let currentUser = null;
let currentPage = "pos";

// Settings
let settings = {
    storeName: "Pa Gerrys Mart",
    storeAddress: "Alatishe, Ibeju Lekki, Lagos State, Nigeria",
    storePhone: "+2347037850121",
    lowStockThreshold: 10,
    expiryWarningDays: 90 // 3 months = 90 days
};

// Local storage keys
const STORAGE_KEYS = {
    PRODUCTS: 'pagerrysmart_products',
    SALES: 'pagerrysmart_sales',
    DELETED_SALES: 'pagerrysmart_deleted_sales',
    USERS: 'pagerrysmart_users',
    SETTINGS: 'pagerrysmart_settings',
    CURRENT_USER: 'pagerrysmart_current_user'
};

// Improved loadFromLocalStorage with better error handling
function loadFromLocalStorage() {
    try {
        // Load products
        const savedProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
        if (savedProducts) {
            const parsedProducts = JSON.parse(savedProducts);
            if (Array.isArray(parsedProducts)) {
                products = parsedProducts;
            } else {
                console.warn('Products data is not an array, resetting to empty array');
                products = [];
            }
        }
        
        // Load sales
        const savedSales = localStorage.getItem(STORAGE_KEYS.SALES);
        if (savedSales) {
            const parsedSales = JSON.parse(savedSales);
            if (Array.isArray(parsedSales)) {
                sales = parsedSales;
            } else {
                console.warn('Sales data is not an array, resetting to empty array');
                sales = [];
            }
        }
        
        // Load deleted sales
        const savedDeletedSales = localStorage.getItem(STORAGE_KEYS.DELETED_SALES);
        if (savedDeletedSales) {
            const parsedDeletedSales = JSON.parse(savedDeletedSales);
            if (Array.isArray(parsedDeletedSales)) {
                deletedSales = parsedDeletedSales;
            } else {
                console.warn('Deleted sales data is not an array, resetting to empty array');
                deletedSales = [];
            }
        }
        
        // Load users
        const savedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
        if (savedUsers) {
            const parsedUsers = JSON.parse(savedUsers);
            if (Array.isArray(parsedUsers)) {
                users = parsedUsers;
            } else {
                console.warn('Users data is not an array, resetting to empty array');
                users = [];
            }
        }
        
        // Load settings
        const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (savedSettings) {
            const parsedSettings = JSON.parse(savedSettings);
            if (parsedSettings && typeof parsedSettings === 'object') {
                settings = { ...settings, ...parsedSettings };
            }
        }
        
        // Load current user
        const savedCurrentUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
        if (savedCurrentUser) {
            const parsedCurrentUser = JSON.parse(savedCurrentUser);
            if (parsedCurrentUser && typeof parsedCurrentUser === 'object') {
                currentUser = parsedCurrentUser;
            }
        }
        
        console.log('Data loaded from localStorage:', {
            products: products.length,
            sales: sales.length,
            deletedSales: deletedSales.length,
            users: users.length,
            hasCurrentUser: !!currentUser
        });
    } catch (e) {
        console.error('Error loading data from localStorage:', e);
        // Reset data to defaults if there's an error
        products = [];
        sales = [];
        deletedSales = [];
        users = [];
        currentUser = null;
    }
}

// Improved saveToLocalStorage with better error handling
function saveToLocalStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
        localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
        localStorage.setItem(STORAGE_KEYS.DELETED_SALES, JSON.stringify(deletedSales));
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
        
        if (currentUser) {
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
        }
        
        console.log('Data saved to localStorage');
    } catch (e) {
        console.error('Error saving data to localStorage:', e);
        showNotification('Error saving data locally. Some changes may be lost.', 'error');
    }
}

// Add data validation function
function validateDataStructure() {
    let isValid = true;
    
    // Validate products
    if (!Array.isArray(products)) {
        console.error('Products is not an array');
        products = [];
        isValid = false;
    }
    
    // Validate sales
    if (!Array.isArray(sales)) {
        console.error('Sales is not an array');
        sales = [];
        isValid = false;
    }
    
    // Validate deleted sales
    if (!Array.isArray(deletedSales)) {
        console.error('Deleted sales is not an array');
        deletedSales = [];
        isValid = false;
    }
    
    // Validate users
    if (!Array.isArray(users)) {
        console.error('Users is not an array');
        users = [];
        isValid = false;
    }
    
    // Validate settings
    if (!settings || typeof settings !== 'object') {
        console.error('Settings is not an object');
        settings = {
            storeName: "Pa Gerrys Mart",
            storeAddress: "Alatishe, Ibeju Lekki, Lagos State, Nigeria",
            storePhone: "+2347037850121",
            lowStockThreshold: 10,
            expiryWarningDays: 90
        };
        isValid = false;
    }
    
    if (!isValid) {
        console.log('Data structure was invalid, has been reset');
        saveToLocalStorage();
    }
    
    return isValid;
}

// Add sales data validation function
function validateSalesData() {
    console.log('🔍 DEBUG: Validating sales data...');
    
    let isValid = true;
    const issues = [];
    
    // Check if sales is an array
    if (!Array.isArray(sales)) {
        issues.push('Sales data is not an array');
        sales = [];
        isValid = false;
    }
    
    // Check each sale for required fields
    sales.forEach((sale, index) => {
        if (!sale || typeof sale !== 'object') {
            issues.push(`Sale at index ${index} is not a valid object`);
            isValid = false;
            return;
        }
        
        if (!sale.receiptNumber) {
            issues.push(`Sale at index ${index} is missing receipt number`);
            isValid = false;
        }
        
        if (!sale.created_at) {
            issues.push(`Sale at index ${index} is missing created date`);
            isValid = false;
        }
        
        if (typeof sale.total !== 'number' || isNaN(sale.total)) {
            issues.push(`Sale at index ${index} has invalid total: ${sale.total}`);
            isValid = false;
        }
        
        if (!Array.isArray(sale.items)) {
            issues.push(`Sale at index ${index} has invalid items array`);
            isValid = false;
        }
    });
    
    if (!isValid) {
        console.warn('⚠️ DEBUG: Sales data validation failed:', issues);
        showNotification('Sales data validation failed. Some data may be missing.', 'warning');
    } else {
        console.log('✅ DEBUG: Sales data validation passed');
    }
    
    return isValid;
}

// DOM elements
const loginPage = document.getElementById('login-page');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginTabs = document.querySelectorAll('.login-tab');
const tabContents = document.querySelectorAll('.tab-content');
const navLinks = document.querySelectorAll('.nav-link');
const pageContents = document.querySelectorAll('.page-content');
const pageTitle = document.getElementById('page-title');
const currentUserEl = document.getElementById('current-user');
const userRoleEl = document.getElementById('user-role');
const userRoleDisplayEl = document.getElementById('user-role-display');
const logoutBtn = document.getElementById('logout-btn');
const productsGrid = document.getElementById('products-grid');
const cartItems = document.getElementById('cart-items');
const totalEl = document.getElementById('total');
const inventoryTableBody = document.getElementById('inventory-table-body');
const inventoryTotalValueEl = document.getElementById('inventory-total-value');
const salesTableBody = document.getElementById('sales-table-body');
const deletedSalesTableBody = document.getElementById('deleted-sales-table-body');
const dailySalesTableBody = document.getElementById('daily-sales-table-body');
const productModal = document.getElementById('product-modal');
const receiptModal = document.getElementById('receipt-modal');
const notification = document.getElementById('notification');
const notificationMessage = document.getElementById('notification-message');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.getElementById('sidebar');

// Loading elements
const inventoryLoading = document.getElementById('inventory-loading');
const reportsLoading = document.getElementById('reports-loading');
const accountLoading = document.getElementById('account-loading');
const productModalLoading = document.getElementById('product-modal-loading');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const registerSubmitBtn = document.getElementById('register-submit-btn');
const changePasswordBtn = document.getElementById('change-password-btn');
const saveProductBtn = document.getElementById('save-product-btn');
const completeSaleBtn = document.getElementById('complete-sale-btn');

// Authentication Module with enhanced error handling
const AuthModule = {
    // Sign up new user (admin only)
    async signUp(email, password, name, role = 'cashier') {
        try {
            // Check if current user is logged in and is admin
            const { data: { user } } = await supabase.auth.getUser();
            if (!user || !currentUser || currentUser.role !== 'admin') {
                showNotification("Only admins can create new users.", "error");
                return { success: false };
            }

            // Ask admin to confirm their password
            const adminPassword = prompt("Please confirm your admin password to continue:");
            if (!adminPassword) {
                return { success: false };
            }

            // Verify admin password
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: currentUser.email,
                password: adminPassword
            });

            if (signInError) {
                showNotification("Incorrect admin password.", "error");
                return { success: false };
            }

            // Create the new user account
            const { data, error } = await supabase.auth.admin.createUser({
                email,
                password,
                user_metadata: {
                    name,
                    role
                }
            });

            if (error) {
                throw error;
            }

            // Save user details in users table with error handling
            try {
                const { error: dbError } = await supabase
                    .from('users')
                    .insert({
                        id: data.user.id,
                        name,
                        email,
                        role,
                        created_at: new Date().toISOString(),
                        last_login: new Date().toISOString(),
                        created_by: user.id
                    });

                if (dbError) {
                    console.warn('Could not save user to database:', dbError);
                    // Continue anyway - auth was successful
                }
            } catch (dbError) {
                console.warn('Database error during user creation:', dbError);
                // Continue anyway - auth was successful
            }

            showNotification(`✅ User "${name}" (${role}) created successfully!`, "success");
            return { success: true };
        } catch (error) {
            console.error("Signup error:", error);
            showNotification("❌ Error creating user: " + error.message, "error");
            return { success: false, error: error.message };
        }
    },

    // Sign in existing user with enhanced error handling
    async signIn(email, password) {
        // Show loading state
        loginSubmitBtn.classList.add('loading');
        loginSubmitBtn.disabled = true;
        
        // Show loading indicator
        const loginLoadingIndicator = document.getElementById('login-loading-indicator');
        if (loginLoadingIndicator) {
            loginLoadingIndicator.style.display = 'block';
        }
        
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                throw error;
            }

            // Create a basic user object from auth data as a fallback
            const fallbackUser = {
                id: data.user.id,
                name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'User',
                email: data.user.email,
                role: data.user.user_metadata?.role || 'cashier',
                created_at: data.user.created_at,
                last_login: new Date().toISOString()
            };

            // Try to get user data from users table with enhanced error handling
            try {
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', data.user.id)
                    .single();

                if (!userError && userData) {
                    currentUser = userData;
                    
                    // Update last login
                    try {
                        await supabase
                            .from('users')
                            .update({ last_login: new Date().toISOString() })
                            .eq('id', data.user.id);
                    } catch (updateError) {
                        console.warn('Could not update last login:', updateError);
                        // Continue even if update fails
                    }
                } else {
                    // If user doesn't exist in users table or there's an error, use fallback
                    console.warn('Using fallback user data due to error:', userError?.message || 'User not found');
                    currentUser = fallbackUser;
                    
                    // Try to create the user in the database, but don't fail if it doesn't work
                    try {
                        const { data: newUser, error: insertError } = await supabase
                            .from('users')
                            .insert(fallbackUser)
                            .select()
                            .single();
                        
                        if (!insertError && newUser) {
                            currentUser = newUser;
                        }
                    } catch (insertError) {
                        console.warn('Could not create user in database:', insertError);
                        // Continue with fallback user data
                    }
                }
            } catch (fetchError) {
                // Handle the infinite recursion error specifically
                if (fetchError.message && fetchError.message.includes('infinite recursion')) {
                    console.warn('Infinite recursion detected in users table policy, using fallback user data');
                    showNotification('Database policy issue detected. Using limited functionality.', 'warning');
                } else {
                    console.warn('Error fetching user data:', fetchError);
                }
                
                // Use fallback user data
                currentUser = fallbackUser;
            }
            
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
            showApp();
            showNotification('Login successful!', 'success');
            return { success: true };
        } catch (error) {
            console.error('Signin error:', error);
            showNotification(error.message || 'Login failed', 'error');
            return { success: false, error: error.message };
        } finally {
            // Hide loading state
            loginSubmitBtn.classList.remove('loading');
            loginSubmitBtn.disabled = false;
            
            // Hide loading indicator
            if (loginLoadingIndicator) {
                loginLoadingIndicator.style.display = 'none';
            }
        }
    },
    
    // Sign out with proper cleanup
    async signOut() {
        try {
            const { error } = await supabase.auth.signOut();
            
            if (error) {
                throw error;
            }
            
            // Clear all app data from local storage
            localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
            // Don't clear other data as it should persist across sessions
            
            currentUser = null;
            showLogin();
            showNotification('Logged out successfully', 'info');
        } catch (error) {
            console.error('Signout error:', error);
            showNotification(error.message, 'error');
        }
    },
    
    // Check if user is admin
    isAdmin() {
        return currentUser && currentUser.role === 'admin';
    },
    
    // Enhanced onAuthStateChanged with proper session handling
    onAuthStateChanged(callback) {
        // First check for existing session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                // User is already signed in
                this.handleExistingSession(session, callback);
            } else {
                // No existing session, set up listener for future auth changes
                supabase.auth.onAuthStateChange(async (event, session) => {
                    if (session) {
                        this.handleExistingSession(session, callback);
                    } else {
                        // User is signed out
                        currentUser = null;
                        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
                        callback(null);
                    }
                });
                
                // No session initially
                callback(null);
            }
        });
    },
    
    // Helper method to handle existing session
    async handleExistingSession(session, callback) {
        // Create a basic user object from auth data as a fallback
        const fallbackUser = {
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
            email: session.user.email,
            role: session.user.user_metadata?.role || 'cashier',
            created_at: session.user.created_at,
            last_login: new Date().toISOString()
        };
        
        try {
            const { data: userData, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();
            
            if (!error && userData) {
                currentUser = userData;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                callback(currentUser);
            } else {
                // If user doesn't exist in users table or there's an error, use fallback
                console.warn('Using fallback user data due to error:', error?.message || 'User not found');
                currentUser = fallbackUser;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                callback(currentUser);
                
                // Try to create the user in the database, but don't fail if it doesn't work
                try {
                    const { data: newUser, error: insertError } = await supabase
                        .from('users')
                        .insert(fallbackUser)
                        .select()
                        .single();
                    
                    if (!insertError && newUser) {
                        currentUser = newUser;
                        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                        callback(currentUser);
                    }
                } catch (insertError) {
                    console.warn('Could not create user in database:', insertError);
                    // Continue with fallback user data
                }
            }
        } catch (fetchError) {
            // Handle the infinite recursion error specifically
            if (fetchError.message && fetchError.message.includes('infinite recursion')) {
                console.warn('Infinite recursion detected in users table policy, using fallback user data');
                showNotification('Database policy issue detected. Using limited functionality.', 'warning');
            } else {
                console.warn('Error fetching user data:', fetchError);
            }
            
            // Use fallback user data
            currentUser = fallbackUser;
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
            callback(currentUser);
        }
    }
};

// Add session refresh mechanism
async function refreshSession() {
    try {
        const { data, error } = await supabase.auth.refreshSession();
        
        if (error) {
            console.error('Error refreshing session:', error);
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Error refreshing session:', error);
        return false;
    }
}

// Data Module with improved error handling
const DataModule = {
    // More flexible fetchProducts function with merge logic
    async fetchProducts() {
        console.log('🔍 DEBUG: fetchProducts called');
        
        try {
            if (isOnline) {
                console.log('🌐 DEBUG: Online, fetching from Supabase');
                
                let query = supabase.from('products').select('*');
                
                // Try to filter by deleted column if it exists
                try {
                    query = query.eq('deleted', false);
                } catch (error) {
                    console.warn('⚠️ DEBUG: deleted column might not exist, fetching all products');
                }
                
                const { data, error } = await query;
                
                console.log('📥 DEBUG: Supabase response:', { data, error });
                
                if (error) {
                    console.error('❌ DEBUG: Supabase fetch error:', error);
                    
                    // Check if it's an RLS policy error
                    if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                        console.warn('⚠️ DEBUG: Infinite recursion detected in products table policy, using local data');
                        showNotification('Database policy issue detected for products. Using local cache.', 'warning');
                    } else if (error.code === '42501' || error.message.includes('policy')) {
                        console.warn('⚠️ DEBUG: Permission denied for products table, using local data');
                        showNotification('Permission denied for products. Using local cache.', 'warning');
                    } else if (error.message.includes('column') && error.message.includes('deleted')) {
                        console.warn('⚠️ DEBUG: deleted column issue, will fetch all products');
                        // Try again without the deleted filter
                        return this.fetchAllProducts();
                    } else {
                        throw error;
                    }
                } else if (data) {
                    console.log('✅ DEBUG: Successfully fetched products from Supabase:', data.length, 'items');
                    
                    // Normalize the data to ensure consistent field names
                    const normalizedProducts = data.map(product => {
                        // Handle the lowercase expirydate field from Supabase
                        if (product.expirydate && !product.expiryDate) {
                            product.expiryDate = product.expirydate;
                        }
                        
                        return product;
                    });
                    
                    // Filter out deleted products locally if needed
                    const activeProducts = normalizedProducts.filter(product => !product.deleted);
                    
                    // Merge with local products to preserve any local changes
                    const mergedProducts = this.mergeProductData(activeProducts);
                    
                    // Update global products variable
                    products = mergedProducts;
                    saveToLocalStorage();
                    console.log('💾 DEBUG: Products saved to localStorage');
                    return products;
                }
            }
            
            // Offline or error: Use local data
            console.log('📴 DEBUG: Using local products data:', products.length, 'items');
            return products;
            
        } catch (error) {
            console.error('❌ DEBUG: Error in fetchProducts:', error);
            
            // Show appropriate error message
            if (error.code === '42501' || error.message.includes('policy')) {
                showNotification('Permission denied for products. Using local cache.', 'warning');
            } else if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Using local cache.', 'warning');
            } else {
                showNotification('Error fetching products: ' + error.message, 'error');
            }
            
            // Fall back to local data
            return products;
        }
    },
    
    // Helper function to merge product data
    mergeProductData(serverProducts) {
        // Create a map of server products by ID for quick lookup
        const serverProductsMap = {};
        serverProducts.forEach(product => {
            serverProductsMap[product.id] = product;
        });
        
        // Create a map of local products by ID for quick lookup
        const localProductsMap = {};
        products.forEach(product => {
            localProductsMap[product.id] = product;
        });
        
        // Merge the data
        const mergedProducts = [];
        
        // First, add all server products
        serverProducts.forEach(serverProduct => {
            const localProduct = localProductsMap[serverProduct.id];
            
            if (localProduct) {
                // If we have a local version, check if it has been modified more recently
                const serverDate = new Date(serverProduct.updated_at || serverProduct.created_at || 0);
                const localDate = new Date(localProduct.updated_at || localProduct.created_at || 0);
                
                if (localDate > serverDate) {
                    // Local version is newer, use it
                    mergedProducts.push(localProduct);
                } else {
                    // Server version is newer or same age, use it
                    mergedProducts.push(serverProduct);
                }
            } else {
                // No local version, use server version
                mergedProducts.push(serverProduct);
            }
        });
        
        // Then, add any local products that aren't on the server
        products.forEach(localProduct => {
            if (!serverProductsMap[localProduct.id]) {
                mergedProducts.push(localProduct);
            }
        });
        
        return mergedProducts;
    },
    
    // Fallback function to fetch all products
    async fetchAllProducts() {
        console.log('🔄 DEBUG: Fetching all products without deleted filter');
        
        try {
            const { data, error } = await supabase.from('products').select('*');
            
            if (error) {
                throw error;
            }
            
            if (data) {
                // Normalize the data to ensure consistent field names
                const normalizedProducts = data.map(product => {
                    // Handle the lowercase expirydate field from Supabase
                    if (product.expirydate && !product.expiryDate) {
                        product.expiryDate = product.expirydate;
                    }
                    
                    return product;
                });
                
                // Filter out deleted products locally
                const activeProducts = normalizedProducts.filter(product => !product.deleted);
                
                // Merge with local products to preserve any local changes
                const mergedProducts = this.mergeProductData(activeProducts);
                
                products = mergedProducts;
                saveToLocalStorage();
                return products;
            }
            
            return products;
        } catch (error) {
            console.error('❌ DEBUG: Error in fetchAllProducts:', error);
            return products;
        }
    },
    
    // Enhanced fetchSales function with better error handling and data preservation
    async fetchSales() {
        console.log('🔍 DEBUG: fetchSales called');
        
        try {
            if (isOnline) {
                console.log('🌐 DEBUG: Online, fetching from Supabase');
                
                // Add timeout to prevent hanging
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout')), 10000)
                );
                
                const fetchPromise = supabase
                    .from('sales')
                    .select('*')
                    .order('created_at', { ascending: false });
                
                const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
                
                console.log('📥 DEBUG: Supabase response:', { data, error });
                
                if (error) {
                    console.error('❌ DEBUG: Supabase fetch error:', error);
                    
                    // Check for specific error types
                    if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                        console.warn('⚠️ DEBUG: Infinite recursion detected in sales table policy');
                        showNotification('Database policy issue for sales. Using local cache.', 'warning');
                    } else if (error.code === '42501' || error.message.includes('policy')) {
                        console.warn('⚠️ DEBUG: Permission denied for sales table');
                        showNotification('Permission denied for sales. Using local cache.', 'warning');
                    } else {
                        throw error;
                    }
                } else if (data && Array.isArray(data)) {
                    console.log('✅ DEBUG: Successfully fetched sales from Supabase:', data.length, 'items');
                    
                    // Validate and normalize sales data
                    const validatedSales = data.map(sale => {
                        // Ensure required fields exist
                        if (!sale.receiptNumber) {
                            console.warn('Sale missing receipt number:', sale);
                            sale.receiptNumber = sale.receipt_number || `UNKNOWN_${Date.now()}`;
                        }
                        
                        if (!sale.items) {
                            console.warn('Sale missing items:', sale);
                            sale.items = [];
                        }
                        
                        if (typeof sale.total !== 'number') {
                            console.warn('Sale has invalid total:', sale);
                            sale.total = parseFloat(sale.total) || 0;
                        }
                        
                        if (!sale.created_at) {
                            console.warn('Sale missing created_at:', sale);
                            sale.created_at = new Date().toISOString();
                        }
                        
                        return sale;
                    });
                    
                    // MERGE LOGIC: Preserve local sales that aren't on server yet
                    const mergedSales = this.mergeSalesData(validatedSales);
                    
                    // Update global sales variable
                    sales = mergedSales;
                    saveToLocalStorage();
                    console.log('💾 DEBUG: Merged sales saved to localStorage');
                    return sales;
                }
            }
            
            // Offline or error: Use local data
            console.log('📴 DEBUG: Using local sales data:', sales.length, 'items');
            return sales;
            
        } catch (error) {
            console.error('❌ DEBUG: Error in fetchSales:', error);
            
            // Show appropriate error message
            if (error.message === 'Request timeout') {
                showNotification('Connection timeout. Using local cache.', 'warning');
            } else if (error.code === '42501' || error.message.includes('policy')) {
                showNotification('Permission denied for sales. Using local cache.', 'warning');
            } else if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Using local cache.', 'warning');
            } else {
                showNotification('Error fetching sales: ' + error.message, 'error');
            }
            
            // Fall back to local data
            return sales;
        }
    },
    
    // NEW: Helper function to merge sales data properly
    mergeSalesData(serverSales) {
        // Create a map of server sales by receipt number for quick lookup
        const serverSalesMap = {};
        serverSales.forEach(sale => {
            serverSalesMap[sale.receiptNumber] = sale;
        });
        
        // Create a map of local sales by receipt number for quick lookup
        const localSalesMap = {};
        sales.forEach(sale => {
            if (sale && sale.receiptNumber) {
                localSalesMap[sale.receiptNumber] = sale;
            }
        });
        
        // Merge the data
        const mergedSales = [];
        
        // First, add all server sales
        serverSales.forEach(serverSale => {
            const localSale = localSalesMap[serverSale.receiptNumber];
            
            if (localSale) {
                // If we have a local version, check if it has been modified more recently
                const serverDate = new Date(serverSale.updated_at || serverSale.created_at || 0);
                const localDate = new Date(localSale.updated_at || localSale.created_at || 0);
                
                if (localDate > serverDate) {
                    // Local version is newer, use it
                    mergedSales.push(localSale);
                } else {
                    // Server version is newer or same age, use it
                    mergedSales.push(serverSale);
                }
            } else {
                // No local version, use server version
                mergedSales.push(serverSale);
            }
        });
        
        // Then, add any local sales that aren't on the server yet
        sales.forEach(localSale => {
            if (localSale && localSale.receiptNumber && !serverSalesMap[localSale.receiptNumber]) {
                mergedSales.push(localSale);
            }
        });
        
        // Sort by date (newest first)
        mergedSales.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
            const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
            return dateB - dateA;
        });
        
        return mergedSales;
    },
    
    // Fetch deleted sales from Supabase
    async fetchDeletedSales() {
        try {
            if (isOnline) {
                const { data, error } = await supabase
                    .from('deleted_sales')
                    .select('*');
                
                if (error) {
                    throw error;
                }
                
                // Update global deletedSales variable
                deletedSales = data;
                saveToLocalStorage();
                
                return deletedSales;
            } else {
                // Offline: Use local data
                return deletedSales;
            }
        } catch (error) {
            console.error('Error fetching deleted sales:', error);
            // Fall back to local data
            return deletedSales;
        }
    },
    
    // Simplified and more reliable saveProduct function with correct field name
    async saveProduct(product) {
        console.log('🔍 DEBUG: saveProduct called with:', product);
        
        // Show loading state
        productModalLoading.style.display = 'flex';
        saveProductBtn.disabled = true;
        
        try {
            // Validate product data
            if (!product.name || !product.category || !product.price || !product.stock || !product.expiryDate) {
                throw new Error('Please fill in all required fields');
            }
            
            if (isNaN(product.price) || product.price <= 0) {
                throw new Error('Please enter a valid price');
            }
            
            if (isNaN(product.stock) || product.stock < 0) {
                throw new Error('Please enter a valid stock quantity');
            }
            
            console.log('✅ DEBUG: Product validation passed');
            
            // Prepare product data for Supabase with CORRECT field name
            const productToSave = {
                name: product.name,
                category: product.category,
                price: parseFloat(product.price),
                stock: parseInt(product.stock),
                expirydate: product.expiryDate,  // FIXED: Use lowercase 'expirydate' to match database
                barcode: product.barcode || null
            };
            
            console.log('📤 DEBUG: Prepared product for Supabase:', productToSave);
            
            let result;
            
            if (product.id && !product.id.startsWith('temp_')) {
                // Update existing product
                console.log('🔄 DEBUG: Updating existing product with ID:', product.id);
                const { data, error } = await supabase
                    .from('products')
                    .update(productToSave)
                    .eq('id', product.id)
                    .select();
                
                if (error) {
                    console.error('❌ DEBUG: Supabase update error:', error);
                    throw error;
                }
                
                console.log('✅ DEBUG: Product updated in Supabase:', data);
                result = { success: true, product: data[0] || product };
            } else {
                // Add new product
                console.log('➕ DEBUG: Adding new product to Supabase');
                const { data, error } = await supabase
                    .from('products')
                    .insert(productToSave)
                    .select();
                
                if (error) {
                    console.error('❌ DEBUG: Supabase insert error:', error);
                    throw error;
                }
                
                console.log('✅ DEBUG: Product added to Supabase:', data);
                
                if (data && data.length > 0) {
                    // Update local product with Supabase ID
                    product.id = data[0].id;
                    result = { success: true, product: data[0] };
                } else {
                    result = { success: true, product };
                }
            }
            
            // Update local products array
            if (product.id && !product.id.startsWith('temp_')) {
                // Update existing
                const index = products.findIndex(p => p.id === product.id);
                if (index >= 0) {
                    products[index] = product;
                }
            } else {
                // Add new
                products.push(product);
            }
            
            // Save to localStorage
            saveToLocalStorage();
            
            return result;
            
        } catch (error) {
            console.error('❌ DEBUG: Error saving product:', error);
            
            // Check if it's a network error
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                console.warn('⚠️ DEBUG: Network error. Saving locally only.');
                showNotification('Network error. Product saved locally only.', 'warning');
                
                // Save locally only
                if (product.id && !product.id.startsWith('temp_')) {
                    const index = products.findIndex(p => p.id === product.id);
                    if (index >= 0) {
                        products[index] = product;
                    }
                } else {
                    product.id = 'temp_' + Date.now();
                    products.push(product);
                }
                saveToLocalStorage();
                
                // Add to sync queue
                addToSyncQueue({
                    type: 'saveProduct',
                    data: product
                });
                
                return { success: true, product };
            } else {
                showNotification('Error saving product: ' + error.message, 'error');
                return { success: false, error: error.message };
            }
        } finally {
            // Hide loading state
            productModalLoading.style.display = 'none';
            saveProductBtn.disabled = false;
        }
    },
    
    // Helper method to save product locally
    saveProductLocally(product) {
        if (product.id && !product.id.startsWith('temp_')) {
            // Update existing product
            const index = products.findIndex(p => p.id === product.id);
            if (index >= 0) {
                products[index] = product;
            }
        } else {
            // Add new product with temporary ID
            product.id = 'temp_' + Date.now();
            products.push(product);
        }
        
        saveToLocalStorage();
        
        // Add to sync queue
        addToSyncQueue({
            type: 'saveProduct',
            data: product
        });
        
        return { success: true, product };
    },
    
    // Updated deleteProduct function
    async deleteProduct(productId) {
        try {
            // Always mark as deleted locally first
            const index = products.findIndex(p => p.id === productId);
            if (index >= 0) {
                products[index].deleted = true;
                products[index].deletedAt = new Date().toISOString();
                saveToLocalStorage();
            }
            
            if (isOnline) {
                // Online: Try to delete from Supabase
                try {
                    // First try to mark as deleted
                    const { error: updateError } = await supabase
                        .from('products')
                        .update({ 
                            deleted: true, 
                            deletedAt: new Date().toISOString() 
                        })
                        .eq('id', productId);
                    
                    if (updateError) {
                        console.warn('⚠️ DEBUG: Could not mark as deleted, trying hard delete');
                        
                        // If marking as deleted fails, try hard delete
                        const { error: deleteError } = await supabase
                            .from('products')
                            .delete()
                            .eq('id', productId);
                        
                        if (deleteError) {
                            console.error('❌ DEBUG: Supabase delete error:', deleteError);
                            throw deleteError;
                        }
                        
                        // Remove from local cache
                        products = products.filter(p => p.id !== productId);
                        saveToLocalStorage();
                    }
                    
                    return { success: true };
                } catch (dbError) {
                    console.error('❌ DEBUG: Database delete failed:', dbError);
                    showNotification('Failed to delete from database. Marked as deleted locally.', 'warning');
                    
                    // Add to sync queue
                    addToSyncQueue({
                        type: 'deleteProduct',
                        id: productId
                    });
                    
                    return { success: true };
                }
            } else {
                // Offline: Add to sync queue
                addToSyncQueue({
                    type: 'deleteProduct',
                    id: productId
                });
                
                return { success: true };
            }
        } catch (error) {
            console.error('❌ DEBUG: Error deleting product:', error);
            showNotification('Error deleting product', 'error');
            return { success: false, error };
        }
    },
    
    // Improved saveSale function with better error handling
    async saveSale(sale) {
        try {
            // Check if sale with this receipt number already exists locally
            const existingSale = sales.find(s => s.receiptNumber === sale.receiptNumber);
            if (existingSale) {
                console.log(`Sale with receipt ${sale.receiptNumber} already exists locally`);
                return { success: true, sale: existingSale };
            }

            // Always save locally first
            const localResult = this.saveSaleLocally(sale);

            if (isOnline) {
                // Online: Try to save to Supabase
                try {
                    // Ensure we have a valid cashierId
                    const validCashierId = await ensureValidUserId(sale.cashierId);
                    
                    if (!validCashierId) {
                        console.error('Cannot save sale: No valid cashier ID');
                        return localResult;
                    }
                    
                    // Update the sale data with the valid cashierId
                    const saleToSave = {
                        ...sale,
                        cashierId: validCashierId
                    };
                    
                    // Try different possible column names
                    const saleWithMultipleNames = {
                        ...saleToSave,
                        // Try different column names
                        receipt_number: saleToSave.receiptNumber,
                        cashier_id: saleToSave.cashierId
                    };
                    
                    const { data, error } = await supabase
                        .from('sales')
                        .insert(saleWithMultipleNames)
                        .select();
                    
                    if (error) {
                        throw error;
                    }
                    
                    if (data && data.length > 0) {
                        // Update local sale with the Supabase ID
                        const index = sales.findIndex(s => s.receiptNumber === sale.receiptNumber);
                        if (index >= 0) {
                            sales[index].id = data[0].id;
                            sales[index].cashierId = validCashierId; // Update with valid ID
                            saveToLocalStorage();
                        }
                        return { success: true, sale: { ...sale, id: data[0].id, cashierId: validCashierId } };
                    } else {
                        throw new Error('No data returned from insert operation');
                    }
                } catch (dbError) {
                    console.error('Database operation failed:', dbError);
                    
                    // Check if it's an RLS policy error
                    if (dbError.code === '42501' || dbError.message.includes('policy')) {
                        showNotification('Permission denied. Sale saved locally only.', 'warning');
                    } else if (dbError.code === '42P17' || dbError.message.includes('infinite recursion')) {
                        showNotification('Database policy issue detected. Sale saved locally only.', 'warning');
                    } else if (dbError.message && dbError.message.includes('column')) {
                        showNotification('Database schema mismatch. Sale saved locally only.', 'warning');
                    } else {
                        showNotification('Database error: ' + dbError.message + '. Sale saved locally.', 'warning');
                    }
                    
                    // Return the local save result
                    return localResult;
                }
            } else {
                // Offline: Add to sync queue
                addToSyncQueue({
                    type: 'saveSale',
                    data: sale
                });
                
                // Return local save result
                return localResult;
            }
        } catch (error) {
            console.error('Error saving sale:', error);
            showNotification('Error saving sale', 'error');
            return { success: false, error };
        }
    },
    
    // Helper method to save sale locally
    saveSaleLocally(sale) {
        // Use a consistent ID format that can be matched later
        sale.id = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        sales.push(sale);
        saveToLocalStorage();

        return { success: true, sale };
    },
    
    // Improved deleteSale function
    async deleteSale(saleId) {
        try {
            // Always mark as deleted locally first
            const saleIndex = sales.findIndex(s => s.id === saleId);
            if (saleIndex >= 0) {
                const sale = sales[saleIndex];
                sale.deleted = true;
                sale.deletedAt = new Date().toISOString();
                deletedSales.push(sale);
                sales.splice(saleIndex, 1);
                saveToLocalStorage();
            }
            
            if (isOnline) {
                // Online: Try to move to deleted sales in Supabase
                try {
                    const { data: saleData, error: fetchError } = await supabase
                        .from('sales')
                        .select('*')
                        .eq('id', saleId)
                        .single();
                    
                    if (fetchError) {
                        throw fetchError;
                    }
                    
                    if (saleData) {
                        // Add a deleted flag and timestamp
                        saleData.deleted = true;
                        saleData.deletedAt = new Date().toISOString();
                        
                        // Add to deleted_sales table
                        const { error: insertError } = await supabase
                            .from('deleted_sales')
                            .insert(saleData);
                        
                        if (insertError) {
                            throw insertError;
                        }
                        
                        // Delete from sales table
                        const { error: deleteError } = await supabase
                            .from('sales')
                            .delete()
                            .eq('id', saleId);
                        
                        if (deleteError) {
                            throw deleteError;
                        }
                        
                        return { success: true };
                    } else {
                        return { success: false, error: 'Sale not found' };
                    }
                } catch (dbError) {
                    console.error('Database delete failed:', dbError);
                    showNotification('Failed to delete from database. Marked as deleted locally.', 'warning');
                    
                    // Add to sync queue
                    addToSyncQueue({
                        type: 'deleteSale',
                        id: saleId
                    });
                    
                    return { success: true };
                }
            } else {
                // Offline: Add to sync queue
                addToSyncQueue({
                    type: 'deleteSale',
                    id: saleId
                });
                
                return { success: true };
            }
        } catch (error) {
            console.error('Error deleting sale:', error);
            showNotification('Error deleting sale', 'error');
            return { success: false, error };
        }
    }
};

// UI Functions
function showLogin() {
    loginPage.style.display = 'flex';
    appContainer.style.display = 'none';
}

// Initialize change password form with username field for accessibility
function initChangePasswordForm() {
    if (currentUser && currentUser.email) {
        // Create a hidden username field for accessibility
        const changePasswordForm = document.getElementById('change-password-form');
        if (changePasswordForm) {
            // Check if username field already exists
            if (!document.getElementById('change-password-username')) {
                const usernameField = document.createElement('input');
                usernameField.type = 'email';
                usernameField.id = 'change-password-username';
                usernameField.name = 'username';
                usernameField.value = currentUser.email;
                usernameField.style.display = 'none';
                usernameField.setAttribute('aria-hidden', 'true');
                usernameField.setAttribute('tabindex', '-1');
                usernameField.setAttribute('autocomplete', 'username');
                
                // Insert at the beginning of the form
                changePasswordForm.insertBefore(usernameField, changePasswordForm.firstChild);
            }
        }
    }
}

// Updated showApp function
async function showApp() {
    loginPage.style.display = 'none';
    appContainer.style.display = 'flex';
    
    // Update user info
    if (currentUser) {
        currentUserEl.textContent = currentUser.name;
        userRoleEl.textContent = currentUser.role;
        userRoleDisplayEl.textContent = currentUser.role;
        
        // Show/hide admin features
        const usersContainer = document.getElementById('users-container');
        if (AuthModule.isAdmin()) {
            usersContainer.style.display = 'block';
        } else {
            usersContainer.style.display = 'none';
        }
        
        // Show/hide add product buttons based on admin status
        const addProductBtns = document.querySelectorAll('.add-product-btn');
        addProductBtns.forEach(btn => {
            btn.style.display = AuthModule.isAdmin() ? 'block' : 'none';
        });
        
        // Initialize the change password form with username field
        initChangePasswordForm();
    }
    
    // Fetch initial data from Supabase
    try {
        console.log('🔄 DEBUG: Fetching initial data from Supabase');
        
        products = await DataModule.fetchProducts();
        console.log('📦 DEBUG: Products loaded:', products.length);
        
        sales = await DataModule.fetchSales();
        console.log('💰 DEBUG: Sales loaded:', sales.length);
        
        deletedSales = await DataModule.fetchDeletedSales();
        console.log('🗑️ DEBUG: Deleted sales loaded:', deletedSales.length);
        
        // Load data into UI
        loadProducts();
        loadSales();
        
        // Set up real-time listeners
        setupRealtimeListeners();
        
    } catch (error) {
        console.error('❌ DEBUG: Error loading initial data:', error);
        showNotification('Error loading data. Using offline cache.', 'warning');
        
        // Fall back to local data
        loadProducts();
        loadSales();
        
        // Set up real-time listeners
        setupRealtimeListeners();
    }
}

function showNotification(message, type = 'success') {
    notificationMessage.textContent = message;
    notification.className = `notification ${type} show`;
    
    // Update icon based on type
    const icon = notification.querySelector('i');
    icon.className = type === 'success' ? 'fas fa-check-circle' : 
                   type === 'error' ? 'fas fa-exclamation-circle' : 
                   type === 'warning' ? 'fas fa-exclamation-triangle' : 
                   'fas fa-info-circle';
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-NG', { 
        style: 'currency', 
        currency: 'NGN',
        minimumFractionDigits: 2
    }).format(amount);
}

// Added null check for toDate() function
function formatDate(date) {
    if (!date) return '-';
    
    // Check if date is a string
    if (typeof date === 'string') {
        const d = new Date(date);
        
        // Check if the date is valid
        if (isNaN(d.getTime())) {
            return '-';
        }
        
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    // If it's already a Date object
    const d = date instanceof Date ? date : new Date(date);
    
    // Check if the date is valid
    if (isNaN(d.getTime())) {
        return '-';
    }
    
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function generateReceiptNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    return `R${year}${month}${day}${random}`;
}

// Page Navigation
function showPage(pageName) {
    // Hide all pages
    pageContents.forEach(page => {
        page.style.display = 'none';
    });
    
    // Show selected page
    const selectedPage = document.getElementById(`${pageName}-page`);
    if (selectedPage) {
        selectedPage.style.display = 'block';
    }
    
    // Update active nav link
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === pageName) {
            link.classList.add('active');
        }
    });
    
    // Update page title
    const titles = {
        'pos': 'Point of Sale',
        'inventory': 'Inventory Management',
        'reports': 'Sales Reports',
        'account': 'My Account'
    };
    
    pageTitle.textContent = titles[pageName] || 'Pa Gerrys Mart';
    currentPage = pageName;
    
    // Load page-specific data
    if (pageName === 'inventory') {
        loadInventory();
    } else if (pageName === 'reports') {
        loadReports();
    } else if (pageName === 'account') {
        loadAccount();
    }
}

// Add function to validate and fix product data
function validateProductData(product) {
    const validatedProduct = { ...product };
    
    // Ensure required fields exist
    if (!validatedProduct.name) validatedProduct.name = 'Unnamed Product';
    if (!validatedProduct.category) validatedProduct.category = 'Uncategorized';
    if (!validatedProduct.price || isNaN(validatedProduct.price)) validatedProduct.price = 0;
    if (!validatedProduct.stock || isNaN(validatedProduct.stock)) validatedProduct.stock = 0;
    if (!validatedProduct.expiryDate) {
        // Set expiry to 1 year from now if not provided
        const date = new Date();
        date.setFullYear(date.getFullYear() + 1);
        validatedProduct.expiryDate = date.toISOString().split('T')[0];
    }
    
    // Convert to proper types
    validatedProduct.price = parseFloat(validatedProduct.price);
    validatedProduct.stock = parseInt(validatedProduct.stock);
    
    // Add the expirydate field for Supabase compatibility
    validatedProduct.expirydate = validatedProduct.expiryDate;
    
    return validatedProduct;
}

// Product Functions
function loadProducts() {
    if (products.length === 0) {
        productsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <h3>No Products Added Yet</h3>
                <p>Click "Add Product" to start adding your inventory</p>
            </div>
        `;
        return;
    }
    
    productsGrid.innerHTML = '';
    
    products.forEach(product => {
        // Skip deleted products
        if (product.deleted) return;
        
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        
        // Check expiry status
        const today = new Date();
        const expiryDate = new Date(product.expiryDate);
        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
        
        let expiryWarning = '';
        let productNameStyle = '';
        
        if (daysUntilExpiry < 0) {
            expiryWarning = `<div class="expiry-warning"><i class="fas fa-exclamation-triangle"></i> Expired</div>`;
            productNameStyle = 'style="color: red; font-weight: bold;"';
        } else if (daysUntilExpiry <= settings.expiryWarningDays) {
            expiryWarning = `<div class="expiry-warning"><i class="fas fa-clock"></i> Expires in ${daysUntilExpiry} days</div>`;
            productNameStyle = 'style="color: red; font-weight: bold;"';
        }
        
        // Check stock status
        let stockClass = 'stock-high';
        if (product.stock <= 0) {
            stockClass = 'stock-low';
        } else if (product.stock <= settings.lowStockThreshold) {
            stockClass = 'stock-medium';
        }
        
        productCard.innerHTML = `
            <div class="product-img">
                <i class="fas fa-box"></i>
            </div>
            <h4 ${productNameStyle}>${product.name}</h4>
            <div class="price">${formatCurrency(product.price)}</div>
            <div class="stock ${stockClass}">Stock: ${product.stock}</div>
            ${expiryWarning}
        `;
        
        productCard.addEventListener('click', () => addToCart(product));
        productsGrid.appendChild(productCard);
    });
}

function loadInventory() {
    inventoryLoading.style.display = 'flex';
    
    setTimeout(() => {
        inventoryLoading.style.display = 'none';
        
        if (products.length === 0) {
            inventoryTableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center;">No products in inventory</td>
                </tr>
            `;
            inventoryTotalValueEl.textContent = formatCurrency(0);
            return;
        }
        
        let totalValue = 0;
        inventoryTableBody.innerHTML = '';
        
        products.forEach(product => {
            // Skip deleted products
            if (product.deleted) return;
            
            totalValue += product.price * product.stock;
            
            // Check expiry status
            const today = new Date();
            const expiryDate = new Date(product.expiryDate);
            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            
            let rowClass = '';
            let stockBadgeClass = 'stock-high';
            let stockBadgeText = 'In Stock';
            let productNameStyle = '';
            
            if (product.stock <= 0) {
                stockBadgeClass = 'stock-low';
                stockBadgeText = 'Out of Stock';
            } else if (product.stock <= settings.lowStockThreshold) {
                stockBadgeClass = 'stock-medium';
                stockBadgeText = 'Low Stock';
            }
            
            let expiryBadgeClass = 'expiry-good';
            let expiryBadgeText = 'Good';
            
            if (daysUntilExpiry < 0) {
                expiryBadgeClass = 'expiry-expired';
                expiryBadgeText = 'Expired';
                rowClass = 'expired';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                expiryBadgeClass = 'expiry-warning';
                expiryBadgeText = 'Expiring Soon';
                rowClass = 'expiring-soon';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            }
            
            const row = document.createElement('tr');
            if (rowClass) row.className = rowClass;
            
            // Build action buttons based on user role
            let actionButtons = '';
            if (AuthModule.isAdmin()) {
                actionButtons = `
                    <div class="action-buttons">
                        <button class="btn-edit" onclick="editProduct('${product.id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="deleteProduct('${product.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            } else {
                actionButtons = '<span class="no-permission">Admin only</span>';
            }
            
            row.innerHTML = `
                <td>${product.id}</td>
                <td ${productNameStyle}>${product.name}</td>
                <td>${product.category}</td>
                <td>${formatCurrency(product.price)}</td>
                <td>${product.stock}</td>
                <td>${formatDate(product.expiryDate)}</td>
                <td>
                    <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
                    <span class="expiry-badge ${expiryBadgeClass}">${expiryBadgeText}</span>
                </td>
                <td>
                    ${actionButtons}
                </td>
            `;
            
            inventoryTableBody.appendChild(row);
        });
        
        inventoryTotalValueEl.textContent = formatCurrency(totalValue);
    }, 500);
}

// Enhanced loadSales function with better debugging
function loadSales() {
    console.log('🔄 DEBUG: loadSales called, current sales count:', sales.length);
    
    // This will be called by real-time listeners
    updateSalesTables();
    
    // Also update any other sales-related UI elements
    if (currentPage === 'reports') {
        generateReport();
    }
}

function loadDeletedSales() {
    // This will be called by real-time listeners
    updateSalesTables();
}

// Enhanced updateSalesTables function with delete button
function updateSalesTables() {
    console.log('🔄 DEBUG: updateSalesTables called');
    
    // Update recent sales table
    if (sales.length === 0) {
        salesTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;">No sales data available</td>
            </tr>
        `;
    } else {
        salesTableBody.innerHTML = '';
        
        // Sort sales by date (newest first)
        const sortedSales = [...sales].sort((a, b) => {
            // Added null checks for toDate()
            const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
            const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
            return dateB - dateA;
        });
        
        // Show only the last 10 sales
        const recentSales = sortedSales.slice(0, 10);
        
        recentSales.forEach(sale => {
            const row = document.createElement('tr');
            
            // Build action buttons based on user role
            let actionButtons = `
                <button class="btn-edit" onclick="viewSale('${sale.id}')" title="View Sale">
                    <i class="fas fa-eye"></i>
                </button>
            `;
            
            // Add delete button only for admins
            if (AuthModule.isAdmin()) {
                actionButtons += `
                    <button class="btn-delete" onclick="deleteSale('${sale.id}')" title="Delete Sale">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
            }
            
            // Calculate total items sold (sum of quantities)
            const totalItemsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            
            row.innerHTML = `
                <td>${sale.receiptNumber}</td>
                <td>${formatDate(sale.created_at)}</td>
                <td>${totalItemsSold}</td>
                <td>${formatCurrency(sale.total)}</td>
                <td>
                    <div class="action-buttons">
                        ${actionButtons}
                    </div>
                </td>
            `;
            
            salesTableBody.appendChild(row);
        });
    }
    
    // Update deleted sales table
    if (deletedSales.length === 0) {
        deletedSalesTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;">No deleted sales</td>
            </tr>
        `;
    } else {
        deletedSalesTableBody.innerHTML = '';
        
        // Sort deleted sales by date (newest first)
        const sortedDeletedSales = [...deletedSales].sort((a, b) => {
            // Added null checks for toDate()
            const dateA = a.deletedAt ? new Date(a.deletedAt) : new Date(0);
            const dateB = b.deletedAt ? new Date(b.deletedAt) : new Date(0);
            return dateB - dateA;
        });
        
        sortedDeletedSales.forEach(sale => {
            const row = document.createElement('tr');
            
            // Calculate total items sold (sum of quantities)
            const totalItemsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            
            row.innerHTML = `
                <td>${sale.receiptNumber}</td>
                <td>${formatDate(sale.created_at)}</td>
                <td>${totalItemsSold}</td>
                <td>${formatCurrency(sale.total)}</td>
                <td><span class="deleted-badge">Deleted</span></td>
            `;
            
            deletedSalesTableBody.appendChild(row);
        });
    }
}

// Enhanced loadReports function
function loadReports() {
    reportsLoading.style.display = 'flex';
    
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    const reportDateEl = document.getElementById('report-date');
    if (reportDateEl) {
        reportDateEl.value = today;
    }
    
    // Use a timeout to ensure loading state is visible
    setTimeout(() => {
        reportsLoading.style.display = 'none';
        
        // Ensure we have sales data before generating report
        if (sales.length === 0) {
            console.log('📊 DEBUG: No sales data, attempting to fetch...');
            DataModule.fetchSales().then(fetchedSales => {
                sales = fetchedSales;
                generateReport();
            }).catch(error => {
                console.error('Error fetching sales for report:', error);
                generateReport(); // Generate with empty data
            });
        } else {
            generateReport();
        }
    }, 500);
}

// Enhanced generateReport function with better error handling
function generateReport() {
    try {
        const selectedDate = document.getElementById('report-date').value;
        
        // Ensure we have valid sales data
        const salesData = Array.isArray(sales) ? sales : [];
        console.log('📊 DEBUG: Generating report with', salesData.length, 'sales');
        
        // Calculate overall summary
        let totalSales = 0;
        let totalTransactions = 0;
        let totalItemsSold = 0;
        
        salesData.forEach(sale => {
            // Skip invalid sales
            if (!sale || typeof sale !== 'object') {
                console.warn('Skipping invalid sale:', sale);
                return;
            }
            
            totalSales += sale.total || 0;
            totalTransactions++;
            
            // Sum up the quantities of all items in the sale
            if (Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    totalItemsSold += item.quantity || 0;
                });
            }
        });
        
        // Update summary elements
        const totalSalesEl = document.getElementById('report-total-sales');
        const totalTransactionsEl = document.getElementById('report-transactions');
        const totalItemsSoldEl = document.getElementById('report-items-sold');
        
        if (totalSalesEl) totalSalesEl.textContent = formatCurrency(totalSales);
        if (totalTransactionsEl) totalTransactionsEl.textContent = totalTransactions;
        if (totalItemsSoldEl) totalItemsSoldEl.textContent = totalItemsSold;
        
        // Calculate daily summary
        let dailyTotal = 0;
        let dailyTransactions = 0;
        let dailyItems = 0;
        
        const dailySales = [];
        
        salesData.forEach(sale => {
            // Skip invalid sales
            if (!sale || typeof sale !== 'object' || !sale.created_at) {
                return;
            }
            
            const saleDate = new Date(sale.created_at);
            
            // Check if date is valid
            if (isNaN(saleDate.getTime())) {
                console.warn('Invalid sale date:', sale.created_at);
                return;
            }
            
            const saleDateString = saleDate.toISOString().split('T')[0];
            
            if (saleDateString === selectedDate) {
                dailyTotal += sale.total || 0;
                dailyTransactions++;
                
                // Sum up the quantities of all items in the sale
                if (Array.isArray(sale.items)) {
                    sale.items.forEach(item => {
                        dailyItems += item.quantity || 0;
                    });
                }
                dailySales.push(sale);
            }
        });
        
        // Update daily summary elements
        const dailyTotalEl = document.getElementById('daily-total-sales');
        const dailyTransactionsEl = document.getElementById('daily-transactions');
        const dailyItemsEl = document.getElementById('daily-items-sold');
        
        if (dailyTotalEl) dailyTotalEl.textContent = formatCurrency(dailyTotal);
        if (dailyTransactionsEl) dailyTransactionsEl.textContent = dailyTransactions;
        if (dailyItemsEl) dailyItemsEl.textContent = dailyItems;
        
        // Update daily sales table
        if (!dailySalesTableBody) {
            console.error('dailySalesTableBody element not found');
            return;
        }
        
        if (dailySales.length === 0) {
            dailySalesTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="no-data">No sales data for selected date</td>
                </tr>
            `;
        } else {
            dailySalesTableBody.innerHTML = '';
            
            // Sort by time (newest first)
            dailySales.sort((a, b) => {
                const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
                const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
                return dateB - dateA;
            });
            
            dailySales.forEach(sale => {
                const row = document.createElement('tr');
                
                // Build action buttons based on user role
                let actionButtons = `
                    <button class="btn-edit" onclick="viewSale('${sale.id}')" title="View Sale">
                        <i class="fas fa-eye"></i>
                    </button>
                `;
                
                // Add delete button only for admins
                if (AuthModule.isAdmin()) {
                    actionButtons += `
                        <button class="btn-delete" onclick="deleteSale('${sale.id}')" title="Delete Sale">
                            <i class="fas fa-trash"></i>
                        </button>
                    `;
                }
                
                // Calculate total items sold
                const totalItemsSold = Array.isArray(sale.items) 
                    ? sale.items.reduce((sum, item) => sum + (item.quantity || 0), 0)
                    : 0;
                
                row.innerHTML = `
                    <td>${sale.receiptNumber || 'N/A'}</td>
                    <td>${formatDate(sale.created_at)}</td>
                    <td>${totalItemsSold}</td>
                    <td>${formatCurrency(sale.total || 0)}</td>
                    <td>
                        <div class="action-buttons">
                            ${actionButtons}
                        </div>
                    </td>
                `;
                
                dailySalesTableBody.appendChild(row);
            });
        }
        
        console.log('✅ DEBUG: Report generated successfully');
    } catch (error) {
        console.error('❌ DEBUG: Error generating report:', error);
        showNotification('Error generating report: ' + error.message, 'error');
    }
}

function loadAccount() {
    accountLoading.style.display = 'flex';
    
    setTimeout(() => {
        accountLoading.style.display = 'none';
        
        if (currentUser) {
            document.getElementById('user-name').textContent = currentUser.name;
            document.getElementById('user-email').textContent = currentUser.email;
            document.getElementById('user-role-display').textContent = currentUser.role;
            document.getElementById('user-created').textContent = formatDate(currentUser.created_at);
            document.getElementById('user-last-login').textContent = formatDate(currentUser.last_login);
        }
        
        // Load users if admin
        if (AuthModule.isAdmin()) {
            loadUsers();
        }
    }, 500);
}

function loadUsers() {
    const usersList = document.getElementById('users-list');
    usersList.innerHTML = '';
    
    if (users.length === 0) {
        usersList.innerHTML = '<p>No users found</p>';
        return;
    }
    
    users.forEach(user => {
        const userCard = document.createElement('div');
        userCard.className = 'user-card';
        
        userCard.innerHTML = `
            <div class="user-info">
                <strong>${user.name}</strong>
                <span>${user.email}</span>
                <span class="role-badge ${user.role}">${user.role}</span>
            </div>
            <div class="action-buttons">
                <button class="btn-delete" onclick="deleteUser('${user.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        
        usersList.appendChild(userCard);
    });
}

// Cart Functions
function addToCart(product) {
    // Check if product is in stock
    if (product.stock <= 0) {
        showNotification('Product is out of stock', 'error');
        return;
    }
    
    // Check if product is already in cart
    const existingItem = cart.find(item => item.id === product.id);
    
    if (existingItem) {
        // Check if adding one more would exceed stock
        if (existingItem.quantity >= product.stock) {
            showNotification('Not enough stock available', 'error');
            return;
        }
        
        existingItem.quantity++;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1
        });
    }
    
    updateCart();
}

function updateCart() {
    if (cart.length === 0) {
        cartItems.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No items in cart</p>';
        totalEl.textContent = formatCurrency(0);
        return;
    }
    
    cartItems.innerHTML = '';
    let total = 0;
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        
        cartItem.innerHTML = `
            <div class="cart-item-info">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">${formatCurrency(item.price)}</div>
                <div class="cart-item-qty">
                    <button onclick="updateQuantity('${item.id}', -1)">-</button>
                    <input type="number" value="${item.quantity}" min="1" readonly>
                    <button onclick="updateQuantity('${item.id}', 1)">+</button>
                </div>
            </div>
            <div class="cart-item-total">${formatCurrency(itemTotal)}</div>
        `;
        
        cartItems.appendChild(cartItem);
    });
    
    totalEl.textContent = formatCurrency(total);
}

function updateQuantity(productId, change) {
    const item = cart.find(item => item.id === productId);
    if (!item) return;
    
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const newQuantity = item.quantity + change;
    
    // Check if new quantity is valid
    if (newQuantity <= 0) {
        // Remove item from cart
        cart = cart.filter(item => item.id !== productId);
    } else if (newQuantity <= product.stock) {
        // Update quantity
        item.quantity = newQuantity;
    } else {
        showNotification('Not enough stock available', 'error');
        return;
    }
    
    updateCart();
}

function clearCart() {
    cart = [];
    updateCart();
}

// Improved completeSale function with better error handling and stock sync
async function completeSale() {
    if (cart.length === 0) {
        showNotification('Cart is empty', 'error');
        return;
    }
    
    // Show loading state
    completeSaleBtn.classList.add('loading');
    completeSaleBtn.disabled = true;
    
    try {
        // Ensure we have a valid cashierId before creating sale
        const validCashierId = await ensureValidUserId(currentUser.id);
        
        if (!validCashierId) {
            showNotification('Error: Invalid user ID. Please try logging in again.', 'error');
            return;
        }
        
        // Create sale object with unique client ID
        const sale = {
            receiptNumber: generateReceiptNumber(),
            clientSaleId: 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            items: [...cart],
            total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            created_at: new Date().toISOString(),
            cashier: currentUser.name,
            cashierId: validCashierId // Use the validated cashier ID
        };
        
        // Save sale with better error handling
        const result = await DataModule.saveSale(sale);
        
        if (result.success) {
            // Update product stock locally
            for (const cartItem of cart) {
                const product = products.find(p => p.id === cartItem.id);
                if (product) {
                    product.stock -= cartItem.quantity;
                    
                    // Add product update to sync queue
                    addToSyncQueue({
                        type: 'saveProduct',
                        data: {
                            id: product.id,
                            stock: product.stock
                        }
                    });
                }
            }
            
            // Save to localStorage
            saveToLocalStorage();
            
            // Show receipt
            showReceipt(result.sale);
            
            // Clear cart
            cart = [];
            updateCart();
            
            // Refresh sales display
            loadSales();
            
            showNotification('Sale completed successfully', 'success');
        } else {
            showNotification('Failed to complete sale', 'error');
        }
    } catch (error) {
        console.error('Error completing sale:', error);
        showNotification('Error completing sale', 'error');
    } finally {
        // Hide loading state
        completeSaleBtn.classList.remove('loading');
        completeSaleBtn.disabled = false;
    }
}

// Function to update product stock
async function updateProductStock(productId, newStock) {
    try {
        // Update locally first
        const product = products.find(p => p.id === productId);
        if (product) {
            product.stock = newStock;
            saveToLocalStorage();
            
            // Add to sync queue
            addToSyncQueue({
                type: 'saveProduct',
                data: {
                    id: productId,
                    stock: newStock
                }
            });
            
            // Update UI
            loadProducts();
            if (currentPage === 'inventory') {
                loadInventory();
            }
            
            return { success: true };
        } else {
            return { success: false, error: 'Product not found' };
        }
    } catch (error) {
        console.error('Error updating product stock:', error);
        return { success: false, error: error.message };
    }
}

function showReceipt(sale) {
    const receiptContent = document.getElementById('receipt-content');
    
    let itemsHtml = '';
    sale.items.forEach(item => {
        itemsHtml += `
            <div class="receipt-item">
                <span>${item.name} x${item.quantity}</span>
                <span>${formatCurrency(item.price * item.quantity)}</span>
            </div>
        `;
    });
    
    receiptContent.innerHTML = `
        <div class="receipt-header">
            <h2>${settings.storeName}</h2>
            <p>${settings.storeAddress}</p>
            <p>${settings.storePhone}</p>
        </div>
        <div class="receipt-items">
            ${itemsHtml}
        </div>
        <div class="receipt-footer">
            <div class="receipt-total">
                <span>Total:</span>
                <span>${formatCurrency(sale.total)}</span>
            </div>
            <div class="receipt-item">
                <span>Receipt #:</span>
                <span>${sale.receiptNumber}</span>
            </div>
            <div class="receipt-item">
                <span>Date:</span>
                <span>${formatDate(sale.created_at)}</span>
            </div>
            <div class="receipt-item">
                <span>Cashier:</span>
                <span>${sale.cashier}</span>
            </div>
        </div>
    `;
    
    receiptModal.style.display = 'flex';
}

function printReceipt() {
    const receiptContent = document.getElementById('receipt-content').innerHTML;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Receipt - ${settings.storeName}</title>
                <style>
                    body { font-family: 'Courier New', monospace; padding: 20px; }
                    .receipt-header { text-align: center; margin-bottom: 20px; }
                    .receipt-items { margin-bottom: 20px; }
                    .receipt-item { display: flex; justify-content: space-between; margin-bottom: 8px; }
                    .receipt-footer { border-top: 1px dashed #ccc; padding-top: 10px; }
                    .receipt-total { display: flex; justify-content: space-between; font-weight: 700; margin-bottom: 5px; }
                </style>
            </head>
            <body>
                ${receiptContent}
            </body>
        </html>
    `);
    
    printWindow.document.close();
    printWindow.print();
}

// Product Modal Functions
function openProductModal(product = null) {
    // Check if user is admin
    if (!AuthModule.isAdmin()) {
        showNotification('Only admins can add or edit products', 'error');
        return;
    }
    
    const modalTitle = document.getElementById('modal-title');
    const productForm = document.getElementById('product-form');
    
    if (product) {
        // Edit mode
        modalTitle.textContent = 'Edit Product';
        document.getElementById('product-name').value = product.name;
        document.getElementById('product-category').value = product.category;
        document.getElementById('product-price').value = product.price;
        document.getElementById('product-stock').value = product.stock;
        document.getElementById('product-expiry').value = product.expiryDate;
        document.getElementById('product-barcode').value = product.barcode || '';
        
        // Store product ID for editing
        productForm.dataset.productId = product.id;
    } else {
        // Add mode
        modalTitle.textContent = 'Add New Product';
        productForm.reset();
        delete productForm.dataset.productId;
    }
    
    productModal.style.display = 'flex';
}

function closeProductModal() {
    productModal.style.display = 'none';
}

// Updated saveProduct function with validation
async function saveProduct() {
    // Check if user is admin
    if (!AuthModule.isAdmin()) {
        showNotification('Only admins can add or edit products', 'error');
        return;
    }
    
    const productForm = document.getElementById('product-form');
    const productId = productForm.dataset.productId;
    
    const productData = validateProductData({
        name: document.getElementById('product-name').value,
        category: document.getElementById('product-category').value,
        price: parseFloat(document.getElementById('product-price').value),
        stock: parseInt(document.getElementById('product-stock').value),
        expiryDate: document.getElementById('product-expiry').value,
        barcode: document.getElementById('product-barcode').value
    });
    
    if (productId) {
        // Update existing product
        productData.id = productId;
    }
    
    const result = await DataModule.saveProduct(productData);
    
    if (result.success) {
        closeProductModal();
        // Force refresh the products list immediately
        products = await DataModule.fetchProducts();
        loadProducts();
        
        if (currentPage === 'inventory') {
            loadInventory();
        }
        showNotification(productId ? 'Product updated successfully' : 'Product added successfully', 'success');
    } else {
        // Error is already shown in the saveProduct function
    }
}

function editProduct(productId) {
    // Check if user is admin
    if (!AuthModule.isAdmin()) {
        showNotification('Only admins can edit products', 'error');
        return;
    }
    
    const product = products.find(p => p.id === productId);
    if (product) {
        openProductModal(product);
    }
}

async function deleteProduct(productId) {
    // Check if user is admin
    if (!AuthModule.isAdmin()) {
        showNotification('Only admins can delete products', 'error');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this product?')) {
        return;
    }
    
    const result = await DataModule.deleteProduct(productId);
    
    if (result.success) {
        // Force refresh the products list immediately
        products = await DataModule.fetchProducts();
        loadProducts();
        
        if (currentPage === 'inventory') {
            loadInventory();
        }
        showNotification('Product deleted successfully', 'success');
    } else {
        showNotification('Failed to delete product', 'error');
    }
}

function viewSale(saleId) {
    const sale = sales.find(s => s.id === saleId);
    if (sale) {
        showReceipt(sale);
    }
}

// Enhanced deleteSale function with better error handling
async function deleteSale(saleId) {
    // Double-check if user is admin
    if (!AuthModule.isAdmin()) {
        showNotification('You do not have permission to delete sales', 'error');
        return;
    }
    
    const sale = sales.find(s => s.id === saleId);
    if (!sale) {
        showNotification('Sale not found', 'error');
        return;
    }
    
    // Show confirmation dialog with sale details
    const confirmMessage = `Are you sure you want to delete this sale?\n\n` +
        `Receipt #: ${sale.receiptNumber}\n` +
        `Date: ${formatDate(sale.created_at)}\n` +
        `Total: ${formatCurrency(sale.total)}\n\n` +
        `This action cannot be undone.`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        const result = await DataModule.deleteSale(saleId);
        
        if (result.success) {
            showNotification('Sale deleted successfully', 'success');
            
            // Force refresh the sales list immediately
            sales = await DataModule.fetchSales();
            updateSalesTables();
            
            // Refresh the reports if we're on the reports page
            if (currentPage === 'reports') {
                generateReport();
            }
        } else {
            showNotification('Failed to delete sale', 'error');
        }
    } catch (error) {
        console.error('Error deleting sale:', error);
        showNotification('Error deleting sale', 'error');
    }
}

// Event Listeners
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    AuthModule.signIn(email, password);
});

registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    const role = document.getElementById('register-role').value;
    
    if (password !== confirmPassword) {
        document.getElementById('register-error').style.display = 'block';
        document.getElementById('register-error').textContent = 'Passwords do not match';
        return;
    }
    
    // Show loading state
    registerSubmitBtn.classList.add('loading');
    registerSubmitBtn.disabled = true;
    
    AuthModule.signUp(email, password, name, role)
        .then(result => {
            if (result.success) {
                // Switch to login tab
                document.querySelector('[data-tab="login"]').click();
                registerForm.reset();
            }
        })
        .finally(() => {
            // Hide loading state
            registerSubmitBtn.classList.remove('loading');
            registerSubmitBtn.disabled = false;
        });
});

// Login tabs
loginTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        
        // Update active tab
        loginTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show corresponding content
        tabContents.forEach(content => {
            content.classList.remove('active');
            if (content.id === `${tabName}-tab` || content.id === `${tabName}-content`) {
                content.classList.add('active');
            }
        });
        
        // Hide error messages
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('register-error').style.display = 'none';
    });
});

// Navigation
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const pageName = link.getAttribute('data-page');
        showPage(pageName);
    });
});

// Mobile menu
mobileMenuBtn.addEventListener('click', () => {
    sidebar.classList.toggle('active');
});

// Logout
logoutBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to logout?')) {
        AuthModule.signOut();
    }
});

// Product search
document.getElementById('search-btn').addEventListener('click', () => {
    const searchTerm = document.getElementById('product-search').value.toLowerCase();
    
    if (!searchTerm) {
        loadProducts();
        return;
    }
    
    const filteredProducts = products.filter(product => {
        return product.name.toLowerCase().includes(searchTerm) ||
               product.category.toLowerCase().includes(searchTerm) ||
               (product.barcode && product.barcode.toLowerCase().includes(searchTerm));
    });
    
    if (filteredProducts.length === 0) {
        productsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <h3>No products found</h3>
                <p>Try a different search term</p>
            </div>
        `;
        return;
    }
    
    productsGrid.innerHTML = '';
    
    filteredProducts.forEach(product => {
        // Skip deleted products
        if (product.deleted) return;
        
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        
        // Check expiry status
        const today = new Date();
        const expiryDate = new Date(product.expiryDate);
        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
        
        let expiryWarning = '';
        let productNameStyle = '';
        
        if (daysUntilExpiry < 0) {
            expiryWarning = `<div class="expiry-warning"><i class="fas fa-exclamation-triangle"></i> Expired</div>`;
            productNameStyle = 'style="color: red; font-weight: bold;"';
        } else if (daysUntilExpiry <= settings.expiryWarningDays) {
            expiryWarning = `<div class="expiry-warning"><i class="fas fa-clock"></i> Expires in ${daysUntilExpiry} days</div>`;
            productNameStyle = 'style="color: red; font-weight: bold;"';
        }
        
        // Check stock status
        let stockClass = 'stock-high';
        if (product.stock <= 0) {
            stockClass = 'stock-low';
        } else if (product.stock <= settings.lowStockThreshold) {
            stockClass = 'stock-medium';
        }
        
        productCard.innerHTML = `
            <div class="product-img">
                <i class="fas fa-box"></i>
            </div>
            <h4 ${productNameStyle}>${product.name}</h4>
            <div class="price">${formatCurrency(product.price)}</div>
            <div class="stock ${stockClass}">Stock: ${product.stock}</div>
            ${expiryWarning}
        `;
        
        productCard.addEventListener('click', () => addToCart(product));
        productsGrid.appendChild(productCard);
    });
});

// Inventory search
document.getElementById('inventory-search-btn').addEventListener('click', () => {
    const searchTerm = document.getElementById('inventory-search').value.toLowerCase();
    
    if (!searchTerm) {
        loadInventory();
        return;
    }
    
    const filteredProducts = products.filter(product => {
        return product.name.toLowerCase().includes(searchTerm) ||
               product.category.toLowerCase().includes(searchTerm) ||
               product.id.toLowerCase().includes(searchTerm);
    });
    
    if (filteredProducts.length === 0) {
        inventoryTableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center;">No products found</td>
            </tr>
        `;
        inventoryTotalValueEl.textContent = formatCurrency(0);
        return;
    }
    
    let totalValue = 0;
    inventoryTableBody.innerHTML = '';
    
    filteredProducts.forEach(product => {
        // Skip deleted products
        if (product.deleted) return;
        
        totalValue += product.price * product.stock;
        
        // Check expiry status
        const today = new Date();
        const expiryDate = new Date(product.expiryDate);
        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
        
        let rowClass = '';
        let stockBadgeClass = 'stock-high';
        let stockBadgeText = 'In Stock';
        let productNameStyle = '';
        
        if (product.stock <= 0) {
            stockBadgeClass = 'stock-low';
            stockBadgeText = 'Out of Stock';
        } else if (product.stock <= settings.lowStockThreshold) {
            stockBadgeClass = 'stock-medium';
            stockBadgeText = 'Low Stock';
        }
        
        let expiryBadgeClass = 'expiry-good';
        let expiryBadgeText = 'Good';
        
        if (daysUntilExpiry < 0) {
            expiryBadgeClass = 'expiry-expired';
            expiryBadgeText = 'Expired';
            rowClass = 'expired';
            productNameStyle = 'style="color: red; font-weight: bold;"';
        } else if (daysUntilExpiry <= settings.expiryWarningDays) {
            expiryBadgeClass = 'expiry-warning';
            expiryBadgeText = 'Expiring Soon';
            rowClass = 'expiring-soon';
            productNameStyle = 'style="color: red; font-weight: bold;"';
        }
        
        const row = document.createElement('tr');
        if (rowClass) row.className = rowClass;
        
        // Build action buttons based on user role
        let actionButtons = '';
        if (AuthModule.isAdmin()) {
            actionButtons = `
                <div class="action-buttons">
                    <button class="btn-edit" onclick="editProduct('${product.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-delete" onclick="deleteProduct('${product.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        } else {
            actionButtons = '<span class="no-permission">Admin only</span>';
        }
        
        row.innerHTML = `
            <td>${product.id}</td>
            <td ${productNameStyle}>${product.name}</td>
            <td>${product.category}</td>
            <td>${formatCurrency(product.price)}</td>
            <td>${product.stock}</td>
            <td>${formatDate(product.expiryDate)}</td>
            <td>
                <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
                <span class="expiry-badge ${expiryBadgeClass}">${expiryBadgeText}</span>
            </td>
            <td>
                ${actionButtons}
            </td>
        `;
        
        inventoryTableBody.appendChild(row);
    });
    
    inventoryTotalValueEl.textContent = formatCurrency(totalValue);
});

// Product buttons
document.getElementById('add-product-btn').addEventListener('click', () => {
    openProductModal();
});

document.getElementById('add-inventory-btn').addEventListener('click', () => {
    openProductModal();
});

document.getElementById('save-product-btn').addEventListener('click', saveProduct);
document.getElementById('cancel-product-btn').addEventListener('click', closeProductModal);

// Cart buttons
document.getElementById('clear-cart-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the cart?')) {
        clearCart();
    }
});

document.getElementById('complete-sale-btn').addEventListener('click', completeSale);

// Receipt modal buttons
document.getElementById('print-receipt-btn').addEventListener('click', printReceipt);
document.getElementById('new-sale-btn').addEventListener('click', () => {
    receiptModal.style.display = 'none';
});

// Report generation
document.getElementById('generate-report-btn').addEventListener('click', generateReport);

// Manual sync button
document.getElementById('manual-sync-btn').addEventListener('click', () => {
    if (isOnline && syncQueue.length > 0) {
        processSyncQueue();
    } else if (!isOnline) {
        showNotification('Cannot sync while offline', 'warning');
    } else {
        showNotification('No data to sync', 'info');
    }
});

// Refresh report button
document.getElementById('refresh-report-btn').addEventListener('click', async () => {
    reportsLoading.style.display = 'flex';
    
    try {
        // Force refresh all data
        await refreshAllData();
        
        // Regenerate the report
        generateReport();
        
        showNotification('Report data refreshed successfully', 'success');
    } catch (error) {
        console.error('Error refreshing report data:', error);
        showNotification('Error refreshing report data', 'error');
    } finally {
        reportsLoading.style.display = 'none';
    }
});

// Debug report button
document.getElementById('debug-report-btn').addEventListener('click', () => {
    console.log('=== SALES REPORT DEBUG ===');
    console.log('Current sales data:', sales);
    console.log('Number of sales:', sales.length);
    console.log('Current page:', currentPage);
    console.log('Is online:', isOnline);
    
    // Check for invalid sales
    const invalidSales = sales.filter(sale => 
        !sale || 
        typeof sale !== 'object' || 
        !sale.receiptNumber || 
        !sale.created_at
    );
    
    if (invalidSales.length > 0) {
        console.warn('Found invalid sales:', invalidSales);
    } else {
        console.log('All sales appear to be valid');
    }
    
    // Check report elements
    const reportElements = {
        'report-total-sales': document.getElementById('report-total-sales'),
        'report-transactions': document.getElementById('report-transactions'),
        'report-items-sold': document.getElementById('report-items-sold'),
        'daily-total-sales': document.getElementById('daily-total-sales'),
        'daily-transactions': document.getElementById('daily-transactions'),
        'daily-items-sold': document.getElementById('daily-items-sold'),
        'daily-sales-table-body': document.getElementById('daily-sales-table-body'),
        'report-date': document.getElementById('report-date')
    };
    
    console.log('Report elements status:');
    Object.entries(reportElements).forEach(([id, element]) => {
        console.log(`${id}:`, element ? 'found' : 'NOT FOUND');
    });
    
    console.log('=== END SALES REPORT DEBUG ===');
});

// Modal close buttons
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.closest('.modal').style.display = 'none';
    });
});

// Change password form
document.getElementById('change-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;
    
    if (newPassword !== confirmPassword) {
        showNotification('Passwords do not match', 'error');
        return;
    }
    
    // Show loading state
    changePasswordBtn.classList.add('loading');
    changePasswordBtn.disabled = true;
    
    try {
        // Re-authenticate user
        const { error } = await supabase.auth.signInWithPassword({
            email: currentUser.email,
            password: currentPassword
        });
        
        if (error) {
            throw error;
        }
        
        // Update password
        const { error: updateError } = await supabase.auth.updateUser({
            password: newPassword
        });
        
        if (updateError) {
            throw updateError;
        }
        
        showNotification('Password changed successfully', 'success');
        document.getElementById('change-password-form').reset();
    } catch (error) {
        console.error('Error changing password:', error);
        showNotification('Failed to change password: ' + error.message, 'error');
    } finally {
        // Hide loading state
        changePasswordBtn.classList.remove('loading');
        changePasswordBtn.disabled = false;
    }
});

// Updated init function with proper session handling
async function init() {
    console.log('🚀 DEBUG: App initialization started');
    
    // Load data from localStorage first
    loadFromLocalStorage();
    loadSyncQueue();
    
    // Validate data structure
    validateDataStructure();
    
    // Clean up duplicate sales
    cleanupDuplicateSales();
    
    // Validate sales data
    validateSalesData();
    
    // Clean up any already synced operations
    cleanupSyncQueue();
    
    // Check for existing Supabase session first
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && !error) {
            // User has an active session, fetch their data
            console.log('🔑 DEBUG: Found existing session:', session.user.id);
            
            // Try to get user data from localStorage first
            const savedUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
            if (savedUser) {
                try {
                    const parsedUser = JSON.parse(savedUser);
                    if (parsedUser.id === session.user.id) {
                        currentUser = parsedUser;
                        console.log('👤 DEBUG: Using cached user data');
                        
                        // Check if we have data in localStorage, if not, fetch from Supabase
                        if (products.length === 0) {
                            console.log('📦 DEBUG: No products in localStorage, fetching from Supabase');
                            try {
                                products = await DataModule.fetchProducts();
                                console.log('📦 DEBUG: Fetched products from Supabase:', products.length);
                            } catch (error) {
                                console.error('❌ DEBUG: Error fetching products from Supabase:', error);
                            }
                        }
                        
                        if (sales.length === 0) {
                            console.log('💰 DEBUG: No sales in localStorage, fetching from Supabase');
                            try {
                                sales = await DataModule.fetchSales();
                                console.log('💰 DEBUG: Fetched sales from Supabase:', sales.length);
                                validateSalesData();
                            } catch (error) {
                                console.error('❌ DEBUG: Error fetching sales from Supabase:', error);
                            }
                        } else {
                            // Validate existing sales data
                            validateSalesData();
                        }
                        
                        if (deletedSales.length === 0) {
                            console.log('🗑️ DEBUG: No deleted sales in localStorage, fetching from Supabase');
                            try {
                                deletedSales = await DataModule.fetchDeletedSales();
                                console.log('🗑️ DEBUG: Fetched deleted sales from Supabase:', deletedSales.length);
                            } catch (error) {
                                console.error('❌ DEBUG: Error fetching deleted sales from Supabase:', error);
                            }
                        }
                        
                        showApp();
                        
                        // Process sync queue if online
                        if (isOnline && syncQueue.length > 0) {
                            setTimeout(() => {
                                processSyncQueue();
                            }, 2000);
                        }
                        
                        return;
                    }
                } catch (e) {
                    console.error('❌ DEBUG: Error parsing saved user data:', e);
                }
            }
            
            // If no cached data or ID mismatch, try to fetch from Supabase
            try {
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', session.user.id)
                    .single();
                
                if (!userError && userData) {
                    currentUser = userData;
                    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                    
                    // Fetch data from Supabase since we don't have it locally
                    console.log('📦 DEBUG: Fetching products from Supabase');
                    products = await DataModule.fetchProducts();
                    console.log('💰 DEBUG: Fetching sales from Supabase');
                    sales = await DataModule.fetchSales();
                    validateSalesData();
                    console.log('🗑️ DEBUG: Fetching deleted sales from Supabase');
                    deletedSales = await DataModule.fetchDeletedSales();
                    
                    showApp();
                    
                    // Process sync queue if online
                    if (isOnline && syncQueue.length > 0) {
                        setTimeout(() => {
                            processSyncQueue();
                        }, 2000);
                    }
                    
                    return;
                } else {
                    console.warn('⚠️ DEBUG: Error fetching user data:', userError?.message || 'User not found');
                    throw userError || new Error('User not found');
                }
            } catch (fetchError) {
                // Handle the infinite recursion error specifically
                if (fetchError.message && fetchError.message.includes('infinite recursion')) {
                    console.warn('⚠️ DEBUG: Infinite recursion detected in users table policy, using fallback user data');
                    showNotification('Database policy issue detected. Using limited functionality.', 'warning');
                } else {
                    console.warn('⚠️ DEBUG: Error fetching user data:', fetchError);
                }
                
                // Use fallback user data from auth session
                const fallbackUser = {
                    id: session.user.id,
                    name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
                    email: session.user.email,
                    role: session.user.user_metadata?.role || 'cashier',
                    created_at: session.user.created_at,
                    last_login: new Date().toISOString()
                };
                
                currentUser = fallbackUser;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                
                // Fetch data from Supabase
                console.log('📦 DEBUG: Fetching products from Supabase');
                products = await DataModule.fetchProducts();
                console.log('💰 DEBUG: Fetching sales from Supabase');
                sales = await DataModule.fetchSales();
                validateSalesData();
                console.log('🗑️ DEBUG: Fetching deleted sales from Supabase');
                deletedSales = await DataModule.fetchDeletedSales();
                
                showApp();
                
                // Process sync queue if online
                if (isOnline && syncQueue.length > 0) {
                    setTimeout(() => {
                        processSyncQueue();
                    }, 2000);
                }
                
                return;
            }
        }
    } catch (sessionError) {
        console.error('❌ DEBUG: Error checking session:', sessionError);
    }
    
    // If we get here, there's no active session, so set up auth state listener
    AuthModule.onAuthStateChanged(async (user) => {
        if (user) {
            // Fetch user data from Supabase if needed
            if (!currentUser || currentUser.id !== user.id) {
                try {
                    const { data, error } = await supabase
                        .from('users')
                        .select('*')
                        .eq('id', user.id)
                        .single();
                    
                    if (!error && data) {
                        currentUser = data;
                        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                    }
                } catch (error) {
                    console.error('❌ DEBUG: Error fetching user data:', error);
                }
            }
            
            // Fetch data from Supabase
            console.log('📦 DEBUG: Fetching products from Supabase');
            products = await DataModule.fetchProducts();
            console.log('💰 DEBUG: Fetching sales from Supabase');
            sales = await DataModule.fetchSales();
            validateSalesData();
            console.log('🗑️ DEBUG: Fetching deleted sales from Supabase');
            deletedSales = await DataModule.fetchDeletedSales();
            
            showApp();
            
            // Process sync queue if online
            if (isOnline && syncQueue.length > 0) {
                setTimeout(() => {
                    processSyncQueue();
                }, 2000);
            }
        } else {
            showLogin();
        }
    });
    
    // Set initial page
    showPage('pos');
    
    // Check online status
    if (isOnline) {
        checkSupabaseConnection();
    }
    
    // Set up session refresh interval (every 30 minutes)
    setInterval(async () => {
        if (currentUser) {
            const refreshed = await refreshSession();
            if (!refreshed) {
                showNotification('Session expired. Please login again.', 'warning');
                AuthModule.signOut();
            }
        }
    }, 30 * 60 * 1000); // 30 minutes
}

// Start the app
init();