// API Health Check - Kiểm tra trạng thái hệ thống
// Endpoint: /api/health

let startTime = Date.now();

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Chỉ cho phép method GET
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Only GET is supported.' 
    });
  }
  
  try {
    // Thu thập thông tin hệ thống
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const currentTime = new Date().toISOString();
    const environment = process.env.VERCEL_ENV || 'development';
    
    // Kiểm tra kết nối đến các service bên ngoài
    const checks = {
      github_api: await checkGitHubAPI(),
      tailscale_api: await checkTailscaleAPI(),
      vercel_status: 'healthy'
    };
    
    // Kiểm tra trạng thái VM trong memory
    const globalVms = global.vms || [];
    const vmStats = {
      total: globalVms.length,
      creating: globalVms.filter(v => v.status === 'creating').length,
      running: globalVms.filter(v => v.status === 'running').length,
      failed: globalVms.filter(v => v.status === 'failed').length,
      expired: globalVms.filter(v => v.status === 'expired').length
    };
    
    // Xác định overall status
    const isHealthy = checks.github_api && checks.tailscale_api;
    
    res.status(200).json({
      success: true,
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: currentTime,
      uptime: {
        seconds: Math.floor(uptime),
        minutes: Math.floor(uptime / 60),
        hours: Math.floor(uptime / 3600),
        formatted: formatUptime(uptime)
      },
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
      },
      environment: environment,
      version: '4.0.0',
      services: checks,
      virtual_machines: vmStats,
      endpoints: {
        health: '/api/health',
        vps: '/api/vps'
      }
    });
    
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Hàm kiểm tra GitHub API
async function checkGitHubAPI() {
  try {
    const startTime = Date.now();
    const response = await fetch('https://api.github.com/zen', {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    const responseTime = Date.now() - startTime;
    
    return {
      status: response.ok ? 'healthy' : 'unhealthy',
      response_time_ms: responseTime,
      message: response.ok ? 'GitHub API is reachable' : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      message: 'Cannot reach GitHub API'
    };
  }
}

// Hàm kiểm tra Tailscale API
async function checkTailscaleAPI() {
  try {
    const startTime = Date.now();
    const response = await fetch('https://api.tailscale.com/api/v2/tailnet/-/devices', {
      method: 'HEAD',
      headers: { 'Accept': 'application/json' }
    });
    const responseTime = Date.now() - startTime;
    
    // Tailscale API trả về 401 nếu không có token, nhưng đó là bình thường (có thể kết nối)
    const isReachable = response.status === 401 || response.status === 200;
    
    return {
      status: isReachable ? 'healthy' : 'unhealthy',
      response_time_ms: responseTime,
      message: isReachable ? 'Tailscale API is reachable' : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      message: 'Cannot reach Tailscale API'
    };
  }
}

// Hàm format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}
