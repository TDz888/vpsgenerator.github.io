// api/vps.js - Anti-block pattern, safe for Safari
let vms = global.vms || [];

// Helper safe function
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch(e) {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS headers - mở rộng tối đa
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // Xử lý preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET - Lấy danh sách VM
  if (req.method === 'GET') {
    try {
      const safeData = {
        success: true,
        vms: vms || [],
        timestamp: Date.now()
      };
      return res.status(200).json(safeData);
    } catch(e) {
      return res.status(200).json({ success: true, vms: [], error: null });
    }
  }
  
  // POST - Tạo VM
  if (req.method === 'POST') {
    try {
      // Lấy body an toàn
      let body = req.body;
      if (!body && req.rawBody) {
        body = safeJsonParse(req.rawBody);
      }
      
      const githubToken = body?.githubToken || '';
      const tailscaleKey = body?.tailscaleKey || '';
      const vmUsername = body?.vmUsername || 'user_' + Date.now();
      const vmPassword = body?.vmPassword || 'Pass@' + Math.random().toString(36).substring(2, 10);
      
      // Tạo VM mới
      const newVM = {
        id: 'vm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: 'vm_' + Date.now().toString(36),
        username: vmUsername,
        password: vmPassword,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 6 * 3600000).toISOString(),
        githubTokenProvided: !!(githubToken && githubToken.length > 10),
        tailscaleKeyProvided: !!(tailscaleKey && tailscaleKey.length > 10)
      };
      
      vms.unshift(newVM);
      if (vms.length > 20) vms.pop();
      global.vms = vms;
      
      return res.status(200).json({
        success: true,
        ...newVM,
        message: 'VM creation started'
      });
      
    } catch(e) {
      return res.status(200).json({
        success: false,
        error: 'Server error, please try again',
        errorCode: 'ERR_001'
      });
    }
  }
  
  // DELETE - Xóa VM
  if (req.method === 'DELETE') {
    try {
      const id = req.query?.id || '';
      const index = vms.findIndex(v => v.id === id);
      if (index !== -1) {
        vms.splice(index, 1);
        global.vms = vms;
      }
      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(200).json({ success: false });
    }
  }
  
  return res.status(200).json({ success: false, error: 'Method not supported' });
}
