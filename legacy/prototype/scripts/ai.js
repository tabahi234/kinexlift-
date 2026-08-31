/**
 * ai.js
 * Handles prompt generation for the AI API without exposing raw logs.
 */

/**
 * Builds the AI prompt payload using static profile, current phase, and rolling ledger.
 * @param {Object} profile - UserProfile object
 * @param {string} currentPhase - Current cycle phase string
 * @param {Array} recentWorkouts - Array of recent workout summaries
 * @returns {string} The prompt payload
 */
function generateAIPrompt(profile, currentPhase, recentWorkouts) {
    // 1. Static User Profile Parameters
    const profileContext = `User Profile: Age ${profile.age}, Weight ${profile.weight}kg, Experience Level: ${profile.experience}, Primary Location: ${profile.location}.`;
    
    // 2. Current Menstrual Cycle Phase
    const phaseContext = `Current Cycle Phase: ${currentPhase.toUpperCase()}.`;
    
    // 3. The "AI Ledger" (Rolling summary string of progress)
    // Here we map raw logs into a summarized string to protect privacy and token limits
    let ledgerString = "No recent workouts logged.";
    if (recentWorkouts && recentWorkouts.length > 0) {
        ledgerString = "Recent Progress Ledger: " + recentWorkouts.map(w => 
            `Completed ${w.type} focusing on ${w.focus}. Intensity rated: ${w.intensity}.`
        ).join(" ");
    }

    // Assembly of the prompt
    const prompt = `
System Directive: You are an expert women's fitness and nutrition AI. Provide specific workout adjustments and localized, affordable nutrition suggestions (e.g., lentils, chickpeas, eggs) tailored to the user's current cycle phase. Keep responses actionable, concise, and scientifically grounded.

CONTEXT:
${profileContext}
${phaseContext}
${ledgerString}

TASK:
Based on the above context, generate:
1. A single sentence workout insight adjusted for the current phase.
2. Three specific, affordable nutrition suggestions supporting this phase.
`;

    return prompt;
}

// Export to window
window.aiService = {
    generateAIPrompt
};
