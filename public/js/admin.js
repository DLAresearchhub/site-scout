/**
 * Site Scout - Admin Dashboard JavaScript
 */

let isAuthenticated = false;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  document.getElementById('login-form').addEventListener('submit', handleLogin);
});

/**
 * Check if user is authenticated
 */
async function checkAuth() {
  try {
    const response = await fetch('/admin/check-auth');
    const data = await response.json();

    if (data.authenticated) {
      isAuthenticated = true;
      showDashboard();
      loadStats();
    } else {
      showLoginScreen();
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    showLoginScreen();
  }
}

/**
 * Handle login form submission
 */
async function handleLogin(e) {
  e.preventDefault();

  const password = document.getElementById('admin-password').value;
  const errorDiv = document.getElementById('login-error');
  errorDiv.classList.remove('show');

  try {
    const response = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      throw new Error('Invalid password');
    }

    isAuthenticated = true;
    document.getElementById('admin-password').value = '';
    showDashboard();
    loadStats();
  } catch (error) {
    console.error('Login error:', error);
    errorDiv.textContent = 'Invalid password. Please try again.';
    errorDiv.classList.add('show');
  }
}

/**
 * Show login screen
 */
function showLoginScreen() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('dashboard-screen').classList.remove('active');
}

/**
 * Show dashboard
 */
function showDashboard() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('dashboard-screen').classList.add('active');
}

/**
 * Load statistics
 */
async function loadStats() {
  try {
    const response = await fetch('/admin/stats');
    if (!response.ok) {
      if (response.status === 401) {
        isAuthenticated = false;
        showLoginScreen();
      }
      return;
    }

    const data = await response.json();
    displayStats(data);
    displayCharts(data);
    displayRecentSessions(data.recentSessions);
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

/**
 * Display statistics
 */
function displayStats(data) {
  document.getElementById('stat-total-sessions').textContent = 
    data.sessions?.total || 0;
  document.getElementById('stat-week-sessions').textContent = 
    data.sessions?.week || 0;
  document.getElementById('stat-today-sessions').textContent = 
    data.sessions?.today || 0;
  document.getElementById('stat-total-images').textContent = 
    data.images?.total || 0;
}

/**
 * Display charts
 */
function displayCharts(data) {
  displayBarChart(data.dailyUsage || []);
  displayTopList(data.topTypes || [], 'top-types');
  displayTopList(data.topCities || [], 'top-cities');
}

/**
 * Display bar chart for daily usage
 */
function displayBarChart(dailyData) {
  const container = document.getElementById('bar-chart');
  container.innerHTML = '';

  if (dailyData.length === 0) {
    container.innerHTML = '<p style="color: var(--color-muted); text-align: center; padding: 40px 0;">No data yet</p>';
    return;
  }

  // Reverse to show oldest first
  const data = [...dailyData].reverse();
  
  // Find max value for scaling
  const maxValue = Math.max(...data.map(d => d.total_images || 1), 1);

  data.forEach(item => {
    const barWrapper = document.createElement('div');
    barWrapper.style.flex = '1';
    barWrapper.style.display = 'flex';
    barWrapper.style.flexDirection = 'column';
    barWrapper.style.alignItems = 'center';

    const bar = document.createElement('div');
    bar.className = 'bar';
    const height = (item.total_images / maxValue) * 100;
    bar.style.height = `${Math.max(height, 5)}%`;
    bar.title = `${item.date}: ${item.total_images} images`;

    const label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = new Date(item.date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });

    barWrapper.appendChild(bar);
    barWrapper.appendChild(label);
    container.appendChild(barWrapper);
  });
}

/**
 * Display top lists (cities or types)
 */
function displayTopList(items, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p style="color: var(--color-muted); text-align: center; padding: 40px 0;">No data yet</p>';
    return;
  }

  items.slice(0, 10).forEach(item => {
    const listItem = document.createElement('div');
    listItem.className = 'list-item';

    const name = document.createElement('div');
    name.className = 'list-item-name';
    name.textContent = item.city || item.building_type || 'Unknown';

    const value = document.createElement('div');
    value.className = 'list-item-value';
    value.textContent = item.count;

    listItem.appendChild(name);
    listItem.appendChild(value);
    container.appendChild(listItem);
  });
}

/**
 * Display recent sessions table
 */
function displayRecentSessions(sessions) {
  const tbody = document.getElementById('recent-sessions-table');
  tbody.innerHTML = '';

  if (sessions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No sessions yet</td></tr>';
    return;
  }

  sessions.forEach(session => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${session.city || 'Unknown'}</td>
      <td>${session.sites_found || 0}</td>
      <td>${session.generation_count || 0}</td>
      <td>${session.total_images || 0}</td>
      <td>${formatDate(session.createdAt)}</td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Logout
 */
async function logout() {
  try {
    await fetch('/admin/logout', { method: 'POST' });
    isAuthenticated = false;
    document.getElementById('admin-password').value = '';
    showLoginScreen();
  } catch (error) {
    console.error('Logout error:', error);
  }
}

// Refresh stats every 30 seconds if authenticated
setInterval(() => {
  if (isAuthenticated) {
    loadStats();
  }
}, 30000);
