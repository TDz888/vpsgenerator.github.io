let vmsStorage = global.vmsStorage || [];

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET - Lấy danh sách VM
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      vms: vmsStorage,
      timestamp: new Date().toISOString()
    });
  }
  
  // POST - Tạo VM mới
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey } = req.body;
    
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing GitHub Token or Tailscale Key'
      });
    }
    
    // Tạo VM record mới
    const newVM = {
      id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      name: `singularity_${Date.now()}`,
      status: 'creating',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      username: 'runneradmin',
      password: 'VPS@123456',
      tailscaleIP: null,
      novncUrl: null,
      repoUrl: 'https://github.com/TDz888/vpsgenerator.github.io'
    };
    
    vmsStorage.unshift(newVM);
    global.vmsStorage = vmsStorage;
    
    // Giới hạn chỉ giữ 10 VM gần nhất
    if (vmsStorage.length > 10) vmsStorage.pop();
    
    return res.status(200).json({
      success: true,
      ...newVM,
      message: 'VM is being created. This takes 2-3 minutes.'
    });
  }
  
  // DELETE - Xóa VM
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const index = vmsStorage.findIndex(vm => vm.id === id);
    
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'VM not found' });
    }
    
    vmsStorage.splice(index, 1);
    global.vmsStorage = vmsStorage;
    
    return res.status(200).json({ success: true, message: 'VM deleted successfully' });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
