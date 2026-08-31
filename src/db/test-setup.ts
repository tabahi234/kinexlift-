// Gives Node a real IndexedDB so the database layer is tested as it actually
// runs in the browser, rather than against a mock that can drift from Dexie.
import 'fake-indexeddb/auto';
