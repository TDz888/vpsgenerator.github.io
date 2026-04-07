// api/vps.js - Zero validation pattern
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow } from './workflow.js';

let vms = global.vms || [];

function generateRepoName() {
  return 'vm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
}

export default async function handler(req, res) {
  // CORS - Accept everything
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, vms: vms });
  }
  
  // DELETE
  if (req.method === 'DELETE') {
    const { id } = req.query;
    vms = vms.filter(v => v.id !== id);
    global.vms = vms;
    return res.status(200).json({ success: true });
  }
  
  // POST
  if (req.method === 'POST') {
    try {
      const body = req.body;
      
      console.log('📥 CREATE VM REQUEST');
      
      // Just check if exists - NO PATTERN
      if (!body.githubToken) {
        return res.status(400).json({ success: false, error: 'Missing GitHub Token' });
      }
      if (!body.tailscaleKey) {
        return res.status(400).json({ success: false, error: 'Missing Tailscale Key' });
      }
      if (!body.vmUsername) {
        return res.status(400).json({ success: false, error: 'Missing Username' });
      }
      
      // Validate token with GitHub
      const tokenCheck = await validateGitHubToken(body.githubToken);
      if (!tokenCheck.valid) {
        return res.status(401).json({ success: false, error: tokenCheck.error });
      }
      
      const owner = tokenCheck.user.login;
      const repoName = generateRepoName();
      
      // Create repo
      const repo = await createRepository(body.githubToken, repoName, 'VM by ' + body.vmUsername);
      if (!repo.success) {
        return res.status(500).json({ success: false, error: repo.error });
      }
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 3000));
      
      // Create workflow
      const workflow = await createWorkflowFile(body.githubToken, owner, repoName, body.vmUsername, body.vmPassword);
      if (!workflow.success) {
        await deleteRepository(body.githubToken, owner, repoName);
        return res.status(500).json({ success: false, error: workflow.error });
      }
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 3000));
      
      // Trigger workflow
      const trigger = await triggerWorkflow(body.githubToken, owner, repoName, body.tailscaleKey);
      if (!trigger.success) {
        return res.status(500).json({ success: false, error: trigger.error });
      }
      
      // Create VM record
      const newVM = {
        id: Date.now().toString(),
        name: repoName,
        owner: owner,
        username: body.vmUsername,
        password: body.vmPassword,
        status: 'creating',
        createdAt: new Date().toISOString(),
        repoUrl: `https://github.com/${owner}/${repoName}`,
        error: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      
      return res.status(200).json({ success: true, ...newVM });
      
    } catch (err) {
      console.error('Error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
