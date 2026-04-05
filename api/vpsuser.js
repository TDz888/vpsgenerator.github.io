const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { userToken, duration = '2h', target_os = 'windows' } = req.body;
  
  if (!userToken) {
    return res.status(400).json({ error: 'GitHub token is required' });
  }
  
  // Đọc file YML mẫu
  const workflowTemplate = fs.readFileSync(path.join(__dirname, '../templates/workflow-template.yml'), 'utf8');
  
  // Thay đổi duration trong YML nếu cần
  let minutes = 120;
  if (duration === '30m') minutes = 30;
  else if (duration === '1h') minutes = 60;
  else if (duration === '2h') minutes = 120;
  else if (duration === '4h') minutes = 240;
  else if (duration === '6h') minutes = 360;
  
  const workflowContent = workflowTemplate.replace(/330/g, minutes.toString());
  
  const timestamp = Date.now();
  const repoName = `vps-${timestamp}`;
  
  try {
    // 1. Get username
    const userResp = await axios.get('https://api.github.com/user', {
      headers: { 'Authorization': `token ${userToken}` }
    });
    const username = userResp.data.login;
    
    // 2. Create repository
    console.log(`Creating repo: ${repoName} for user: ${username}`);
    await axios.post('https://api.github.com/user/repos', {
      name: repoName,
      description: 'VPS Generator - Temporary Windows VM',
      private: false,
      auto_init: true
    }, {
      headers: {
        'Authorization': `token ${userToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    // 3. Create .github/workflows directory and workflow file
    const encodedContent = Buffer.from(workflowContent).toString('base64');
    
    await axios.put(
      `https://api.github.com/repos/${username}/${repoName}/contents/.github/workflows/create-vps.yml`,
      {
        message: 'Add VPS workflow',
        content: encodedContent,
        branch: 'main'
      },
      {
        headers: {
          'Authorization': `token ${userToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    // 4. Trigger workflow
    await axios.post(
      `https://api.github.com/repos/${username}/${repoName}/actions/workflows/create-vps.yml/dispatches`,
      { ref: 'main' },
      {
        headers: {
          'Authorization': `token ${userToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    res.status(200).json({
      success: true,
      message: 'VPS creation started!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      note: 'VNC link will appear in vnc-link.txt when ready. Password: vps123'
    });
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
};
