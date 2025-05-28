// Global variables
let timer;
let timerRunning = false;
let timeRemaining = 25 * 60; // Default to 25 minutes (in seconds)
let currentMode = 'focus'; // 'focus' or 'break'
let activePreset = 'pomodoro'; // Default preset
let soundEnabled = true;
let dailyGoal = 120; // Default 120 minutes
let updateInterval;
let soundVolume = 1.0; // Default full volume

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

// Sound effects with volume control
const tickSound = new Audio('../sounds/tick.mp3');
const alarmSound = new Audio('../sounds/alarm.mp3');

// DOM elements
document.addEventListener('DOMContentLoaded', () => {
  // Check if popup was opened with sound trigger
  checkForSoundTrigger();
  
  // Initialize theme
  loadThemePreference();
  
  // Connect to background script and get current state
  fetchTimerState();
  
  // Set up regular updates from background
  setupBackgroundSync();
  
  // Add event listeners
  setupEventListeners();
  
  // Setup scroll behavior
  setupScrollBehavior();
});

// Check URL for sound trigger
function checkForSoundTrigger() {
  const urlParams = new URLSearchParams(window.location.search);
  const playSound = urlParams.get('play');
  
  if (playSound === 'alarm' && soundVolume > 0) {
    // Play alarm sound immediately
    alarmSound.volume = soundVolume;
    alarmSound.currentTime = 0;
    alarmSound.play().catch(err => console.log('Audio error:', err));
    
    // Flash the timer display to provide visual feedback
    const timerDisplay = document.querySelector('.timer-display');
    if (timerDisplay) {
      timerDisplay.classList.add('flash-animation');
      setTimeout(() => {
        timerDisplay.classList.remove('flash-animation');
      }, 1500);
    }
  }
}

// Setup scroll behavior
function setupScrollBehavior() {
  // Preserve scroll position when toggling stats panel
  document.getElementById('stats-toggle').addEventListener('click', () => {
    // Short delay to allow DOM updates
    setTimeout(() => {
      const container = document.querySelector('.container');
      // Store scroll position in session
      sessionStorage.setItem('16bit-timer-scroll', container.scrollTop);
    }, 100);
  });
  
  // Restore scroll position if stored
  const savedScrollPosition = sessionStorage.getItem('16bit-timer-scroll');
  if (savedScrollPosition) {
    setTimeout(() => {
      const container = document.querySelector('.container');
      container.scrollTop = parseInt(savedScrollPosition);
    }, 100);
  }
}

// Set up all event listeners
function setupEventListeners() {
  // Timer controls
  document.getElementById('start-btn').addEventListener('click', startTimer);
  document.getElementById('pause-btn').addEventListener('click', pauseTimer);
  document.getElementById('reset-btn').addEventListener('click', resetTimer);
  document.getElementById('skip-btn').addEventListener('click', skipSession);
  
  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      if (this.id === 'custom-preset') {
        selectPreset('custom');
      } else {
        selectPreset(this.id);
      }
    });
  });
  
  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('change', toggleTheme);
  
  // Stats toggle
  document.getElementById('stats-toggle').addEventListener('click', toggleStats);
  
  // Daily goal
  document.getElementById('save-goal').addEventListener('click', saveDailyGoal);
  
  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.querySelector('.close').addEventListener('click', closeSettings);
  document.getElementById('save-custom').addEventListener('click', saveCustomSettings);
  document.getElementById('volume-slider').addEventListener('input', updateVolumeDisplay);
  document.getElementById('volume-slider').addEventListener('change', saveVolumeSettings);
  
  // Listen for background updates
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return;
    
    switch (message.action) {
      case 'timerUpdate':
        updateFromBackground(message);
        break;
        
      case 'minuteTick':
        if (soundVolume > 0) {
          tickSound.volume = soundVolume;
          tickSound.play().catch(err => console.log('Audio error:', err));
        }
        updateFromBackground(message);
        break;
        
      case 'finalCountdown':
        if (soundVolume > 0) {
          tickSound.currentTime = 0;
          tickSound.volume = soundVolume;
          tickSound.play().catch(err => console.log('Audio error:', err));
        }
        updateFromBackground(message);
        break;
        
      case 'timerComplete':
        if (soundVolume > 0) {
          alarmSound.currentTime = 0;
          alarmSound.volume = soundVolume;
          alarmSound.play().catch(err => console.log('Audio error:', err));
        }
        updateFromBackground(message);
        break;
        
      case 'statsUpdate':
        updateStatsFromBackground(message);
        break;
    }
  });
}

// Background communication
function setupBackgroundSync() {
  // Only use the backup interval check every 10 seconds instead of 5
  // Since we're now getting frequent updates from the background script
  updateInterval = setInterval(fetchTimerState, 10000); // Every 10 seconds as backup
  
  // Update when popup becomes visible
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      fetchTimerState();
    }
  });
  
  // Request immediate sync when popup opens
  fetchTimerState();
}

// This flag helps avoid unnecessary UI updates when values haven't changed
let lastTimeRemaining = null;

function fetchTimerState() {
  chrome.runtime.sendMessage({ action: 'getTimerState' }, (response) => {
    if (chrome.runtime.lastError) {
      console.log("Error fetching timer state:", chrome.runtime.lastError);
      return;
    }
    
    if (response && response.timerState) {
      updateFromBackground({
        timerState: response.timerState,
        stats: response.stats
      });
    }
  });
}

function updateFromBackground(message) {
  if (!message.timerState) return;
  
  // Update local state
  timerRunning = message.timerState.running;
  timeRemaining = message.timerState.timeRemaining;
  currentMode = message.timerState.currentMode;
  activePreset = message.timerState.activePreset;
  
  // Update volume setting if available
  if (message.timerState.soundVolume !== undefined) {
    soundVolume = message.timerState.soundVolume;
  }
  
  // Only update the timer display if value actually changed (prevents flicker)
  if (lastTimeRemaining !== timeRemaining) {
    lastTimeRemaining = timeRemaining;
    updateTimerDisplay(timeRemaining);
  }
  
  // Other UI updates
  updateSessionType();
  highlightActivePreset();
  
  // If stats included, update them too
  if (message.stats) {
    updateStatsFromBackground({ stats: message.stats });
  }
}

function updateStatsFromBackground(message) {
  if (!message.stats) return;
  
  // Update local stats
  stats = message.stats;
  
  // Update UI
  updateStatsDisplay();
  updateProgressBar();
}

function updateSessionType() {
  // Update the session status indicator
  const sessionStatus = document.getElementById('session-status');
  
  if (currentMode === 'focus') {
    sessionStatus.textContent = 'FOCUS';
    sessionStatus.className = 'focus-mode';
  } else {
    sessionStatus.textContent = 'BREAK';
    sessionStatus.className = 'break-mode';
  }
}

function toggleSessionType() {
  currentMode = currentMode === 'focus' ? 'break' : 'focus';
  updateSessionType();
}

function highlightActivePreset() {
  // Remove active class from all presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Add active class to selected preset
  const presetId = activePreset === 'custom' ? 'custom-preset' : activePreset;
  const selectedBtn = document.getElementById(presetId);
  if (selectedBtn) {
    selectedBtn.classList.add('active');
  }
}

// Timer functions
function startTimer() {
  if (timerRunning) return;
  
  // Send command to background
  chrome.runtime.sendMessage({ action: 'startTimer' });
  
  // Optimistically update UI
  timerRunning = true;
}

function pauseTimer() {
  if (!timerRunning) return;
  
  // Send command to background
  chrome.runtime.sendMessage({ action: 'pauseTimer' });
  
  // Optimistically update UI
  timerRunning = false;
}

function resetTimer() {
  // Send command to background
  chrome.runtime.sendMessage({ action: 'resetTimer' });
}

function skipSession() {
  // Send command to background
  chrome.runtime.sendMessage({ action: 'skipSession' });
}

// Display functions
function updateTimerDisplay(seconds) {
  // Ensure we're working with an integer by rounding
  seconds = Math.round(seconds);
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  const display = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  document.getElementById('timer').textContent = display;
}

// Preset selection
function selectPreset(presetId) {
  // Send command to background
  chrome.runtime.sendMessage({ 
    action: 'selectPreset',
    presetId: presetId
  });
  
  // Optimistically update UI
  activePreset = presetId;
  highlightActivePreset();
}

function updateStatsDisplay() {
  document.getElementById('sessions-today').textContent = stats.sessionsToday;
  document.getElementById('total-focus-time').textContent = `${stats.totalFocusTime} min`;
  document.getElementById('all-time-sessions').textContent = stats.allTimeSessions;
  document.getElementById('current-streak').textContent = `${stats.currentStreak} days`;
  document.getElementById('longest-streak').textContent = `${stats.longestStreak} days`;
}

function updateProgressBar() {
  const percent = Math.min(100, Math.round((stats.focusToday / dailyGoal) * 100));
  document.getElementById('progress-fill').style.width = `${percent}%`;
  document.getElementById('progress-percent').textContent = `${percent}%`;
  document.getElementById('progress-minutes').textContent = `${stats.focusToday}/${dailyGoal} min`;
  
  // Update daily goal input field
  document.getElementById('daily-goal').value = dailyGoal;
}

function saveDailyGoal() {
  const newGoal = parseInt(document.getElementById('daily-goal').value) || 120;
  dailyGoal = Math.min(Math.max(newGoal, 15), 480); // Min 15, max 480
  document.getElementById('daily-goal').value = dailyGoal;
  
  // Send to background
  chrome.runtime.sendMessage({ 
    action: 'updateDailyGoal',
    dailyGoal: dailyGoal
  });
  
  updateProgressBar();
}

function toggleStats() {
  const statsPanel = document.getElementById('stats-panel');
  const statsToggle = document.getElementById('stats-toggle');
  
  statsPanel.classList.toggle('hidden');
  
  // Update the indicator characters based on panel state
  if (statsPanel.classList.contains('hidden')) {
    statsToggle.textContent = '▼ STATS ▼';
  } else {
    statsToggle.textContent = '▲ STATS ▲';
  }
  
  // Short delay to allow DOM updates
  setTimeout(() => {
    const container = document.querySelector('.container');
    // Store scroll position in session
    sessionStorage.setItem('16bit-timer-scroll', container.scrollTop);
  }, 100);
}

// Settings functions
function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  
  // Populate settings with current values
  const focusMinutes = Math.floor(sessionConfig.custom.focus);
  const focusSeconds = Math.round((sessionConfig.custom.focus - focusMinutes) * 60);
  
  const breakMinutes = Math.floor(sessionConfig.custom.break);
  const breakSeconds = Math.round((sessionConfig.custom.break - breakMinutes) * 60);
  
  document.getElementById('focus-minutes').value = focusMinutes;
  document.getElementById('focus-seconds').value = focusSeconds;
  document.getElementById('break-minutes').value = breakMinutes;
  document.getElementById('break-seconds').value = breakSeconds;
  
  // Set volume slider to current volume
  const volumeSlider = document.getElementById('volume-slider');
  volumeSlider.value = Math.round(soundVolume * 100);
  updateVolumeDisplay();
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function saveCustomSettings() {
  const focusMinutes = parseInt(document.getElementById('focus-minutes').value) || 0;
  const focusSeconds = parseInt(document.getElementById('focus-seconds').value) || 0;
  const breakMinutes = parseInt(document.getElementById('break-minutes').value) || 0;
  const breakSeconds = parseInt(document.getElementById('break-seconds').value) || 0;
  
  // Calculate total time in minutes (with decimal for seconds)
  const totalFocusTime = focusMinutes + (focusSeconds / 60);
  const totalBreakTime = breakMinutes + (breakSeconds / 60);
  
  // Validate and set minimum values (minimum is now 1 second = 0.0167 minutes)
  const validFocus = Math.max(totalFocusTime, 0.0167);
  const validBreak = Math.max(totalBreakTime, 0.0167);
  
  // Update local config
  sessionConfig.custom.focus = validFocus;
  sessionConfig.custom.break = validBreak;
  
  // Send to background
  chrome.runtime.sendMessage({ 
    action: 'updateCustomTimer',
    focus: validFocus,
    break: validBreak
  });
  
  // Close settings modal
  closeSettings();
}

function updateVolumeDisplay() {
  const volumeSlider = document.getElementById('volume-slider');
  const volumeValue = document.getElementById('volume-value');
  
  volumeValue.textContent = `${volumeSlider.value}%`;
}

function saveVolumeSettings() {
  const volumeSlider = document.getElementById('volume-slider');
  soundVolume = parseInt(volumeSlider.value) / 100;
  
  // Send to background
  chrome.runtime.sendMessage({ 
    action: 'updateVolumeSettings',
    soundVolume: soundVolume
  });
}

// Theme functions
function toggleTheme() {
  const isDarkMode = document.getElementById('theme-toggle').checked;
  
  if (isDarkMode) {
    document.body.setAttribute('data-theme', 'dark');
  } else {
    document.body.removeAttribute('data-theme');
  }
  
  // Send to background
  chrome.runtime.sendMessage({ 
    action: 'updateDarkMode',
    darkMode: isDarkMode
  });
}

function loadThemePreference() {
  chrome.storage.sync.get('bitTimerSettings', (data) => {
    if (data.bitTimerSettings) {
      if (data.bitTimerSettings.hasOwnProperty('darkMode')) {
        const isDarkMode = data.bitTimerSettings.darkMode;
        if (isDarkMode) {
          document.body.setAttribute('data-theme', 'dark');
          document.getElementById('theme-toggle').checked = true;
        }
      }
      
      // Load volume setting
      if (data.bitTimerSettings.hasOwnProperty('soundVolume')) {
        soundVolume = data.bitTimerSettings.soundVolume;
      }
    }
  });
} 