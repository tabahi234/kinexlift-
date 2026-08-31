/**
 * cycle.js
 * Hardcoded cycle-synced logic for adjusting working weights based on cycle day.
 */

const PHASES = {
    FOLLICULAR: 'follicular',
    OVULATION: 'ovulation',
    LUTEAL: 'luteal',
    MENSTRUATION: 'menstruation'
};

/**
 * Calculates current cycle day and phase based on last period start date.
 * @param {string} lastPeriodStartISO 
 * @param {number} cycleLength 
 * @returns {Object} { currentDay, phase }
 */
function getCurrentCycleStatus(lastPeriodStartISO, cycleLength = 28) {
    const start = new Date(lastPeriodStartISO);
    const today = new Date();
    
    // Calculate difference in days
    const diffTime = Math.abs(today - start);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    const currentDay = (diffDays % cycleLength) + 1;
    
    let phase = PHASES.FOLLICULAR;
    if (currentDay >= 1 && currentDay <= 5) {
        phase = PHASES.MENSTRUATION;
    } else if (currentDay >= 6 && currentDay <= 11) {
        phase = PHASES.FOLLICULAR;
    } else if (currentDay >= 12 && currentDay <= 16) {
        phase = PHASES.OVULATION;
    } else if (currentDay >= 17 && currentDay <= cycleLength) {
        phase = PHASES.LUTEAL;
    }
    
    return { currentDay, phase };
}

/**
 * Utility function to adjust working weight based on current cycle phase.
 * @param {number} baseWeight - The standard working weight
 * @param {string} phase - Current cycle phase
 * @returns {number} Adjusted weight
 */
function adjustWeightForPhase(baseWeight, phase) {
    switch(phase) {
        case PHASES.FOLLICULAR:
            // Push Hard. Increase volume/weight. (Base or +5%)
            return baseWeight * 1.05;
        case PHASES.OVULATION:
            // Max Output. PR focus. (+10%)
            return baseWeight * 1.10;
        case PHASES.LUTEAL:
            // Taper Down. Drop the working weight by 10-15%.
            return baseWeight * 0.85;
        case PHASES.MENSTRUATION:
            // Active Recovery. Lower intensity. (-20%)
            return baseWeight * 0.80;
        default:
            return baseWeight;
    }
}

// Export to window for global access
window.cycleLogic = {
    getCurrentCycleStatus,
    adjustWeightForPhase,
    PHASES
};
