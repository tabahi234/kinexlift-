/**
 * db.js
 * Handles localForage initialization and User Profile JSON schema logic.
 */

// Initialize localForage instances
const userStore = localforage.createInstance({
    name: "FitLifeDB",
    storeName: "userProfile"
});

const workoutStore = localforage.createInstance({
    name: "FitLifeDB",
    storeName: "workoutLogs"
});

/**
 * User Profile JSON Schema
 * @typedef {Object} UserProfile
 * @property {number} age - User's age
 * @property {number} weight - User's weight in kg
 * @property {string} experience - Beginner, Intermediate, Advanced
 * @property {string} location - Gym or Home
 * @property {number} cycleLength - Average cycle length in days
 * @property {Date} lastPeriodStart - Date of last period
 */

const defaultProfile = {
    age: 28,
    weight: 60,
    experience: 'Intermediate',
    location: 'Gym',
    cycleLength: 28,
    lastPeriodStart: new Date().toISOString()
};

// Initialize DB with default profile if empty
async function initDB() {
    try {
        const profile = await userStore.getItem('profile');
        if (!profile) {
            await userStore.setItem('profile', defaultProfile);
            console.log('Initialized default user profile.');
        } else {
            console.log('User profile loaded:', profile);
        }
    } catch (err) {
        console.error('Error initializing DB:', err);
    }
}

// Global Export Function
window.exportUserData = async function() {
    try {
        const profile = await userStore.getItem('profile');
        const logs = []; // In a real scenario, fetch all from workoutStore
        await workoutStore.iterate((value, key) => {
            logs.push({ id: key, ...value });
        });

        const exportData = {
            exportDate: new Date().toISOString(),
            profile,
            workoutLogs: logs
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "fitlife_export.json");
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        
        console.log('Export successful');
    } catch (err) {
        console.error('Export failed:', err);
    }
};

// Run init on load
initDB();
