// api/vps.js - Siêu đơn giản, KHÔNG validation pattern
let vms = global.vms || [];

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET: Lấy danh sách VM
  if (req.method === 'GET') {
    console.log('📋 GET /api/vps - Returning', vms.length, 'VMs');
    return res.status(200).json({ 
      success: true, 
      vms: vms,
      message: 'API is working'
    });
  }
  
  // POST: Tạo VM
  if (req.method === 'POST') {
    console.log('📥 POST /api/vps - Received request');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { githubToken, tailscaleKey, vmUsername, vmPassword } = req.body;
    
    // Kiểm tra đơn giản - KHÔNG check pattern
    if (!githubToken || githubToken.length < 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Thiếu GitHub Token'
      });
    }
    
    if (!tailscaleKey || tailscaleKey.length < 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Thiếu Tailscale Key'
      });
    }
    
    // Tạo VM giả lập để test (trả về thành công ngay)
    const newVM = {
      id: `vm_${Date.now()}`,
      name: `test-vm-${Date.now()}`,
      username: vmUsername || 'testuser',
      status: 'creating',
      createdAt: new Date().toISOString(),
      message: 'VM creation started - This is a test response'
    };
    
    vms.unshift(newVM);
    global.vms = vms;
    
    console.log('✅ VM created (test mode):', newVM.id);
    
    return res.status(200).json({ 
      success: true, 
      ...newVM,
      note: 'Test mode - GitHub Actions not actually triggered'
    });
  }
  
  // DELETE: Xóa VM
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const index = vms.findIndex(v => v.id === id);
    if (index !== -1) {
      vms.splice(index, 1);
      global.vms = vms;
    }
    return res.status(200).json({ success: true });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
