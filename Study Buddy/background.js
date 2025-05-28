// Background script for Study Buddy extension
// Handles timer functionality in the background

// Timer state
let timerState = {
  running: false,
  timeRemaining: 25 * 60, // Default to 25 minutes (in seconds)
  currentMode: 'focus', // 'focus' or 'break'
  activePreset: 'pomodoro', // Default preset
  timerStartTime: null,
  timerEndTime: null
};

// Session configuration
let sessionConfig = {
  pomodoro: { focus: 25, break: 5 },
  fiftyTen: { focus: 50, break: 10 },
  ninetyTwenty: { focus: 90, break: 20 },
  custom: { focus: 25, break: 5 } // Default custom values
};

// Statistics tracking
let stats = {
  sessionsToday: 0,
  totalFocusTime: 0, // in minutes
  allTimeSessions: 0,
  lastDate: new Date().toDateString(),
  focusToday: 0, // Focus minutes today
  currentStreak: 0,
  longestStreak: 0,
  lastActiveDate: null
};

// User preferences
let userPreferences = {
  soundVolume: 1.0, // Default full volume (100%)
  dailyGoal: 120,
  darkMode: false
};

// Badge status tracking
let badgeState = {
  timerCompleted: false,
  lastCompletedMode: null
};

// Sound objects for background playback
let sounds = {
  alarm: null,
  tick: null
};

// Initialize sounds
function initSounds() {
  sounds.alarm = new Audio(chrome.runtime.getURL('sounds/alarm.mp3'));
  sounds.tick = new Audio(chrome.runtime.getURL('sounds/tick.mp3'));
}

// Timer functionality
function startTimer() {
  if (timerState.running) return;
  
  timerState.running = true;
  
  // Calculate exact end time to account for background throttling
  const now = Date.now();
  if (!timerState.timerStartTime) {
    timerState.timerStartTime = now;
    timerState.timerEndTime = now + (timerState.timeRemaining * 1000);
  }
  
  // Create an alarm for the timer completion
  chrome.alarms.clear("timerAlarm");
  chrome.alarms.create("timerAlarm", {
    when: timerState.timerEndTime
  });
  
  // Create a periodic alarm for timer updates (every 1 second)
  chrome.alarms.clear("timerTick");
  chrome.alarms.create("timerTick", {
    periodInMinutes: 1/60,  // 1 second in minutes
    delayInMinutes: 0       // Start immediately
  });
  
  // Save state
  saveTimerState();
  
  // Notify popup about timer update
  notifyPopup();
}

function pauseTimer() {
  if (!timerState.running) return;
  
  // Clear alarms
  chrome.alarms.clear("timerAlarm");
  chrome.alarms.clear("timerTick");
  
  timerState.running = false;
  
  // Calculate remaining time based on actual elapsed time
  if (timerState.timerEndTime) {
    const now = Date.now();
    timerState.timeRemaining = Math.max(0, Math.floor((timerState.timerEndTime - now) / 1000));
  }
  
  // Reset timer endpoints
  timerState.timerStartTime = null;
  timerState.timerEndTime = null;
  
  // Save state
  saveTimerState();
  
  // Notify popup about timer update
  notifyPopup();
}

function resetTimer() {
  pauseTimer();
  
  // Reset to current session type's time
  const minutesToSet = timerState.currentMode === 'focus' 
    ? sessionConfig[getPresetKey(timerState.activePreset)].focus 
    : sessionConfig[getPresetKey(timerState.activePreset)].break;
    
  // Convert to seconds and ensure it's a rounded integer
  timerState.timeRemaining = Math.round(minutesToSet * 60);
  
  // Reset timer endpoints
  timerState.timerStartTime = null;
  timerState.timerEndTime = null;
  
  // Save state
  saveTimerState();
  
  // Notify popup about timer update
  notifyPopup();
}

function skipSession() {
  pauseTimer();
  toggleSessionType();
  resetTimer();
}

function completeSession() {
  pauseTimer();
  
  // Show notification
  showNotification();
  
  // Set badge to indicate timer completion
  setBadgeForTimerCompletion();
  
  // Open the popup to play sound and show timer completion
  openPopupWindow();
  
  // Notify popup to play alarm sound (for when popup is open)
  notifyPopup('timerComplete');
  
  // Update stats if completing a focus session
  if (timerState.currentMode === 'focus') {
    updateStats();
  }
  
  // Switch between focus and break
  toggleSessionType();
  resetTimer();
}

// Function to open popup window
function openPopupWindow() {
  // Get the popup URL with sound trigger parameter
  const popupUrl = chrome.runtime.getURL('popup.html?play=alarm');
  
  // Check if we already have a popup window open
  chrome.windows.getAll({populate: true}, (windows) => {
    let popupExists = false;
    
    // Look through all windows and their tabs
    for (const window of windows) {
      for (const tab of window.tabs) {
        if (tab.url && tab.url.includes('popup.html')) {
          // Focus the existing window/tab and update URL to include sound trigger
          chrome.windows.update(window.id, {focused: true});
          chrome.tabs.update(tab.id, {
            active: true,
            url: popupUrl
          });
          popupExists = true;
          break;
        }
      }
      if (popupExists) break;
    }
    
    // If no popup is open, create one
    if (!popupExists) {
      chrome.windows.create({
        url: popupUrl,
        type: 'popup',
        width: 370,
        height: 520,
        focused: true
      });
    }
  });
}

function toggleSessionType() {
  timerState.currentMode = timerState.currentMode === 'focus' ? 'break' : 'focus';
  
  // Save state
  saveTimerState();
  
  // Notify popup about timer update
  notifyPopup();
}

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "timerAlarm") {
    // Timer completed
    completeSession();
  } else if (alarm.name === "timerTick" && timerState.running) {
    // Timer tick - update time remaining
    updateTimerTick();
  }
});

function updateTimerTick() {
  if (!timerState.running || !timerState.timerEndTime) return;
  
  const now = Date.now();
  const remaining = Math.max(0, Math.floor((timerState.timerEndTime - now) / 1000));
  
  // Update time remaining
  timerState.timeRemaining = remaining;
  
  // Notify for minute changes (for tick sounds on popup)
  if (remaining % 60 === 0 && remaining > 0) {
    notifyPopup('minuteTick');
  }
  
  // Notify for final countdown
  if (remaining <= 5 && remaining > 0) {
    // Play tick sound directly from background for final countdown
    playSound('tick');
    notifyPopup('finalCountdown');
  }
  
  // Check if timer completed
  if (remaining <= 0) {
    // In case the alarm hasn't fired yet
    completeSession();
  } else {
    // Always notify popup for immediate UI updates
    notifyPopup();
  }
}

function updateStats() {
  // Check if it's a new day
  const today = new Date().toDateString();
  if (stats.lastDate !== today) {
    // Update streak if yesterday was active
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toDateString();
    
    if (stats.lastActiveDate === yesterdayString) {
      stats.currentStreak++;
    } else {
      stats.currentStreak = 1; // Reset streak but count today
    }
    
    // Update longest streak if current streak is longer
    if (stats.currentStreak > stats.longestStreak) {
      stats.longestStreak = stats.currentStreak;
    }
    
    stats.focusToday = 0;
    stats.sessionsToday = 0;
    stats.lastDate = today;
  }
  
  // Mark today as active for streak calculation
  stats.lastActiveDate = today;
  
  // Update session stats
  stats.sessionsToday++;
  stats.allTimeSessions++;
  
  // Add the completed focus time
  const focusMinutes = sessionConfig[getPresetKey(timerState.activePreset)].focus;
  stats.totalFocusTime += focusMinutes;
  stats.focusToday += focusMinutes;
  
  // Save and update
  saveSettings();
  
  // Notify popup about stats update
  notifyPopup('statsUpdate');
}

function getPresetKey(presetId) {
  switch (presetId) {
    case 'pomodoro': return 'pomodoro';
    case 'fifty-ten': return 'fiftyTen';
    case 'ninety-twenty': return 'ninetyTwenty';
    case 'custom-preset':
    case 'custom': return 'custom';
    default: return 'pomodoro';
  }
}

function selectPreset(presetId) {
  timerState.activePreset = presetId;
  
  // Reset timer to the selected preset's focus time
  pauseTimer();
  timerState.currentMode = 'focus';
  
  const presetKey = getPresetKey(presetId);
  // Ensure timeRemaining is a rounded integer
  timerState.timeRemaining = Math.round(sessionConfig[presetKey].focus * 60);
  
  // Save state
  saveTimerState();
  saveSettings();
  
  // Notify popup about timer update
  notifyPopup();
}

// Storage & state functions
function saveTimerState() {
  chrome.storage.local.set({ timerState });
}

function loadTimerState() {
  chrome.storage.local.get('timerState', (data) => {
    if (data.timerState) {
      // Restore timer state
      timerState = data.timerState;
      
      // If timer was running, restart it
      if (timerState.running && timerState.timerEndTime) {
        // Check if timer should still be running
        const now = Date.now();
        if (now < timerState.timerEndTime) {
          // Resume timer
          startTimer();
        } else {
          // Timer should have completed while extension was closed
          timerState.timeRemaining = 0;
          completeSession();
        }
      }
    }
  });
}

function saveSettings() {
  const settingsToSave = {
    sessionConfig,
    activePreset: timerState.activePreset,
    stats,
    soundVolume: userPreferences.soundVolume,
    dailyGoal: userPreferences.dailyGoal,
    darkMode: userPreferences.darkMode
  };
  
  chrome.storage.sync.set({ bitTimerSettings: settingsToSave });
}

function loadSettings() {
  chrome.storage.sync.get('bitTimerSettings', (data) => {
    if (data.bitTimerSettings) {
      const savedSettings = data.bitTimerSettings;
      
      // Load session configuration
      if (savedSettings.sessionConfig) {
        sessionConfig = savedSettings.sessionConfig;
      }
      
      // Load active preset
      if (savedSettings.activePreset) {
        timerState.activePreset = savedSettings.activePreset;
      }
      
      // Load stats
      if (savedSettings.stats) {
        // Check if it's a new day
        const today = new Date().toDateString();
        if (savedSettings.stats.lastDate !== today) {
          // Reset daily stats but keep streak information
          savedSettings.stats.sessionsToday = 0;
          savedSettings.stats.focusToday = 0;
          savedSettings.stats.lastDate = today;
        }
        
        stats = savedSettings.stats;
        
        // Initialize streak properties if they don't exist
        if (stats.currentStreak === undefined) stats.currentStreak = 0;
        if (stats.longestStreak === undefined) stats.longestStreak = 0;
        if (stats.lastActiveDate === undefined) stats.lastActiveDate = null;
        if (stats.focusToday === undefined) stats.focusToday = 0;
      }
      
      // Load user preferences
      if (savedSettings.hasOwnProperty('soundVolume')) {
        userPreferences.soundVolume = savedSettings.soundVolume;
      }
      
      if (savedSettings.hasOwnProperty('dailyGoal')) {
        userPreferences.dailyGoal = savedSettings.dailyGoal;
      }
      
      if (savedSettings.hasOwnProperty('darkMode')) {
        userPreferences.darkMode = savedSettings.darkMode;
      }
    }
  });
}

// Notification functions
function showNotification() {
  const mode = timerState.currentMode === 'focus' ? 'Focus' : 'Break';
  const nextMode = timerState.currentMode === 'focus' ? 'Break' : 'Focus';
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon-128.png',
    title: `${mode} Session Complete!`,
    message: `Your ${mode.toLowerCase()} session is complete. Starting ${nextMode.toLowerCase()} session.`,
    priority: 2
  });
}

// Message handling for popup communication
function notifyPopup(event = 'timerUpdate') {
  // Include sound volume with timer state
  const timerStateWithSound = {
    ...timerState,
    soundVolume: userPreferences.soundVolume
  };
  
  // Check if there are any listeners before sending the message
  chrome.runtime.sendMessage({
    action: event,
    timerState: timerStateWithSound,
    stats
  }).catch(error => {
    // Ignore "receiving end does not exist" errors - this is normal when popup is closed
    if (!error.message.includes("receiving end does not exist")) {
      console.error("Error sending message to popup:", error);
    }
  });
}

// Badge functions
function setBadgeForTimerCompletion() {
  // Store that we have a completed timer and its mode
  badgeState.timerCompleted = true;
  badgeState.lastCompletedMode = timerState.currentMode;
  
  // Set badge text and color
  const badgeText = timerState.currentMode === 'focus' ? 'DONE' : 'BREAK';
  const badgeColor = timerState.currentMode === 'focus' ? '#D35400' : '#27AE60';
  
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: badgeColor });
}

function clearBadge() {
  badgeState.timerCompleted = false;
  chrome.action.setBadgeText({ text: '' });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;
  
  switch (message.action) {
    case 'getTimerState':
      // When the popup requests state, clear the badge as user has seen notification
      if (badgeState.timerCompleted) {
        clearBadge();
      }
      sendResponse({ timerState, stats });
      break;
      
    case 'startTimer':
      startTimer();
      sendResponse({ success: true });
      break;
      
    case 'pauseTimer':
      pauseTimer();
      sendResponse({ success: true });
      break;
      
    case 'resetTimer':
      resetTimer();
      sendResponse({ success: true });
      break;
      
    case 'skipSession':
      skipSession();
      sendResponse({ success: true });
      break;
      
    case 'selectPreset':
      if (message.presetId) {
        selectPreset(message.presetId);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No preset ID provided' });
      }
      break;
      
    case 'updateVolumeSettings':
      if (message.hasOwnProperty('soundVolume')) {
        userPreferences.soundVolume = message.soundVolume;
        saveSettings();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No volume setting provided' });
      }
      break;
      
    case 'updateDailyGoal':
      if (message.hasOwnProperty('dailyGoal')) {
        userPreferences.dailyGoal = message.dailyGoal;
        saveSettings();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No daily goal provided' });
      }
      break;
      
    case 'updateDarkMode':
      if (message.hasOwnProperty('darkMode')) {
        userPreferences.darkMode = message.darkMode;
        saveSettings();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No dark mode setting provided' });
      }
      break;
      
    case 'updateCustomTimer':
      if (message.focus && message.break) {
        // Store values as-is with decimal precision for seconds
        sessionConfig.custom.focus = parseFloat(message.focus);
        sessionConfig.custom.break = parseFloat(message.break);
        saveSettings();
        
        // If current preset is custom, update the timer
        if (timerState.activePreset === 'custom') {
          resetTimer();
        }
        
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Invalid custom timer settings' });
      }
      break;
  }
  
  return true; // Keep message channel open for async response
});

// Sound function
function playSound(soundName) {
  // Don't play if volume is 0
  if (userPreferences.soundVolume <= 0) return;
  
  const sound = sounds[soundName];
  if (sound) {
    sound.volume = userPreferences.soundVolume;
    sound.currentTime = 0;
    
    // Use a Promise to handle playback
    sound.play().catch(err => {
      console.log(`Error playing ${soundName} sound:`, err);
    });
  }
}

// Initialize on extension load
chrome.runtime.onInstalled.addListener((details) => {
  // Initialize sounds
  initSounds();
  
  if (details.reason === 'install') {
    // Initialize default settings on first install
    const defaultSettings = {
      sessionConfig: {
        pomodoro: { focus: 25, break: 5 },
        fiftyTen: { focus: 50, break: 10 },
        ninetyTwenty: { focus: 90, break: 20 },
        custom: { focus: 25, break: 5 }
      },
      activePreset: 'pomodoro',
      stats: {
        sessionsToday: 0,
        totalFocusTime: 0,
        allTimeSessions: 0,
        lastDate: new Date().toDateString(),
        focusToday: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null
      },
      soundVolume: 1.0,
      dailyGoal: 120,
      darkMode: false
    };
    
    // Save default settings
    chrome.storage.sync.set({ bitTimerSettings: defaultSettings });
    
    // Request notification permission
    chrome.permissions.request({
      permissions: ['notifications']
    });
  }
  
  // Load saved state and settings
  loadSettings();
  loadTimerState();
});

// On startup, restore timer state
chrome.runtime.onStartup.addListener(() => {
  // Initialize sounds
  initSounds();
  
  loadSettings();
  loadTimerState();
}); 