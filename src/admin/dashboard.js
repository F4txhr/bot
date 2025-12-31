const express = require('express');
const { supabase } = require('../database');
const config = require('../config');
const { createLogger, formatDuration } = require('../utils');

const logger = createLogger('Dashboard');

async function getDashboardStats() {
  try {
    const stats = {};

    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    stats.totalUsers = totalUsers || 0;

    const { count: activePairs } = await supabase
      .from('pairs')
      .select('*', { count: 'exact', head: true });
    stats.activePairs = activePairs || 0;

    const { count: queueCount } = await supabase
      .from('queue_free')
      .select('*', { count: 'exact', head: true });
    stats.queueCount = queueCount || 0;

    const { count: bannedUsers } = await supabase
      .from('banned_users')
      .select('*', { count: 'exact', head: true });
    stats.bannedUsers = bannedUsers || 0;

    const { count: premiumUsers } = await supabase
      .from('premium_users')
      .select('*', { count: 'exact', head: true })
      .gt('expires_at', new Date().toISOString());
    stats.premiumUsers = premiumUsers || 0;

    const { count: totalReports } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true });
    stats.totalReports = totalReports || 0;

    const { data: recentReports } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    stats.recentReports = recentReports || [];

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: newUsersToday } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneDayAgo);
    stats.newUsersToday = newUsersToday || 0;

    return stats;
  } catch (error) {
    logger.error('Error fetching dashboard stats', { error: error.message });
    return null;
  }
}

async function getRecentActivity(limit = 50) {
  try {
    const { data: reports } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    return {
      reports: reports || []
    };
  } catch (error) {
    logger.error('Error fetching recent activity', { error: error.message });
    return { reports: [] };
  }
}

async function getUserDetails(userId) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: premium } = await supabase
      .from('premium_users')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: banned } = await supabase
      .from('banned_users')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: reports } = await supabase
      .from('reports')
      .select('*')
      .eq('reported_user_id', userId)
      .order('created_at', { ascending: false });

    return {
      user: user || null,
      premium: premium || null,
      banned: banned || null,
      reports: reports || []
    };
  } catch (error) {
    logger.error('Error fetching user details', { error: error.message, userId });
    return null;
  }
}

function generateDashboardHTML(stats) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShadowChat Admin Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    .header h1 { font-size: 32px; margin-bottom: 10px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: #1e293b;
      padding: 25px;
      border-radius: 12px;
      border: 1px solid #334155;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .stat-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    }
    .stat-label {
      font-size: 14px;
      color: #94a3b8;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 36px;
      font-weight: 700;
      color: #fff;
    }
    .stat-icon {
      font-size: 20px;
      float: right;
      opacity: 0.7;
    }
    .section {
      background: #1e293b;
      padding: 25px;
      border-radius: 12px;
      margin-bottom: 20px;
      border: 1px solid #334155;
    }
    .section h2 {
      font-size: 22px;
      margin-bottom: 20px;
      color: #f1f5f9;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #334155;
      padding: 12px;
      text-align: left;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #334155;
    }
    tr:hover {
      background: #2d3748;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-danger { background: #ef4444; color: white; }
    .badge-warning { background: #f59e0b; color: white; }
    .badge-success { background: #10b981; color: white; }
    .badge-info { background: #3b82f6; color: white; }
    .refresh-btn {
      background: #667eea;
      color: white;
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: background 0.2s;
    }
    .refresh-btn:hover {
      background: #5568d3;
    }
    .timestamp {
      color: #94a3b8;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 ShadowChat Admin Dashboard</h1>
      <p>Real-time monitoring & analytics</p>
      <button class="refresh-btn" onclick="location.reload()">🔄 Refresh Data</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">👥 Total Users</div>
        <div class="stat-value">${stats.totalUsers.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">💬 Active Chats</div>
        <div class="stat-value">${stats.activePairs.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">🔄 In Queue</div>
        <div class="stat-value">${stats.queueCount.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">💎 Premium Users</div>
        <div class="stat-value">${stats.premiumUsers.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">🚫 Banned Users</div>
        <div class="stat-value">${stats.bannedUsers.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">🆕 New Today</div>
        <div class="stat-value">${stats.newUsersToday.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">📋 Total Reports</div>
        <div class="stat-value">${stats.totalReports.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">⚡ Bot Status</div>
        <div class="stat-value"><span class="badge badge-success">ONLINE</span></div>
      </div>
    </div>

    <div class="section">
      <h2>📋 Recent Reports</h2>
      <table>
        <thead>
          <tr>
            <th>Reporter ID</th>
            <th>Reported User ID</th>
            <th>Reason</th>
            <th>Timestamp</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${stats.recentReports.length > 0 ? stats.recentReports.map(report => `
            <tr>
              <td>${report.reporter_id}</td>
              <td>${report.reported_user_id}</td>
              <td>${report.reason || 'No reason provided'}</td>
              <td class="timestamp">${new Date(report.created_at).toLocaleString()}</td>
              <td><span class="badge badge-warning">Pending</span></td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;">No reports yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    setInterval(() => {
      const timestamps = document.querySelectorAll('.timestamp');
      timestamps.forEach(ts => {
        const date = new Date(ts.textContent);
        ts.textContent = date.toLocaleString();
      });
    }, 1000);
  </script>
</body>
</html>
  `;
}

function setupDashboardRoutes(app, requireAuth) {
  app.get('/admin/dashboard', requireAuth, async (req, res) => {
    try {
      const stats = await getDashboardStats();
      if (!stats) {
        return res.status(500).send('Error loading dashboard');
      }
      const html = generateDashboardHTML(stats);
      res.send(html);
    } catch (error) {
      logger.error('Dashboard error', { error: error.message });
      res.status(500).send('Internal server error');
    }
  });

  app.get('/admin/api/stats', requireAuth, async (req, res) => {
    try {
      const stats = await getDashboardStats();
      res.json(stats);
    } catch (error) {
      logger.error('Stats API error', { error: error.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/admin/api/activity', requireAuth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const activity = await getRecentActivity(limit);
      res.json(activity);
    } catch (error) {
      logger.error('Activity API error', { error: error.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/admin/api/user/:userId', requireAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      if (!userId) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      const userDetails = await getUserDetails(userId);
      res.json(userDetails);
    } catch (error) {
      logger.error('User details API error', { error: error.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

module.exports = {
  getDashboardStats,
  getRecentActivity,
  getUserDetails,
  generateDashboardHTML,
  setupDashboardRoutes
};
