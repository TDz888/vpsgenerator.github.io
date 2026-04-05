const { Octokit } = require('@octokit/rest');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { githubToken } = req.body;

  if (!githubToken) {
    return res.status(400).json({ error: 'Thiếu GitHub token' });
  }

  try {
    const octokit = new Octokit({ auth: githubToken });
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const username = user.login;
    const repoName = `vps-${Date.now()}`;

    // Tạo repo KHÔNG auto_init để tránh lỗi SHA
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'VPS từ GitHub Actions',
      private: false,
      auto_init: false
    });

    // === 1. Tạo file workflow .github/workflows/vps.yml ===
    const workflowContent = `name: VPS Auto Deploy

on:
  schedule:
    - cron: '*/10 * * * *'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Run VPS
        run: |
          echo "========================================="
          echo "VPS ĐANG CHẠY - Created by Hiếu Dz"
          echo "========================================="
          while true; do
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] VPS is running..."
            sleep 60
          done
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: '.github/workflows/vps.yml',
      message: 'Add VPS workflow',
      content: Buffer.from(workflowContent).toString('base64')
    });

    // === 2. Tạo file README.md ===
    const readmeContent = `# VPS Manager - Created by Hiếu Dz

VPS đã được tạo thành công!

## Thông tin
- **Repo:** https://github.com/${username}/${repoName}
- **Actions:** https://github.com/${username}/${repoName}/actions

## Trạng thái
VPS đang chạy với GitHub Actions. Workflow sẽ tự động chạy mỗi 10 phút.

---
*VPS Project - ${repoName}*
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'README.md',
      message: 'Add README',
      content: Buffer.from(readmeContent).toString('base64')
    });

    // === 3. Tạo file auto-start.yml (giống trong ảnh) ===
    const autoStartContent = `name: Auto Start VPS

on:
  push:
    branches: [ main ]
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

jobs:
  start:
    runs-on: ubuntu-latest
    steps:
      - name: Start VPS
        run: |
          echo "Auto starting VPS..."
          curl -X POST https://api.github.com/repos/${{ github.repository }}/actions/workflows/vps.yml/dispatches \\
            -H "Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}" \\
            -H "Accept: application/vnd.github.v3+json" \\
            -d '{"ref":"main"}'
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'auto-start.yml',
      message: 'Add auto-start config',
      content: Buffer.from(autoStartContent).toString('base64')
    });

    // === 4. Tạo file remote-link.txt ===
    const remoteLinkContent = `VPS Remote Access
Created: ${new Date().toISOString()}
Repo: https://github.com/${username}/${repoName}
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'remote-link.txt',
      message: 'Updated remote-link',
      content: Buffer.from(remoteLinkContent).toString('base64')
    });

    // === 5. Tạo file restart.lock ===
    const restartLockContent = `Auto restart - ${new Date().toISOString()}
Status: Active
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'restart.lock',
      message: 'Auto restart lock',
      content: Buffer.from(restartLockContent).toString('base64')
    });

    // Kích hoạt workflow lần đầu
    try {
      await octokit.rest.actions.createWorkflowDispatch({
        owner: username,
        repo: repoName,
        workflow_id: 'vps.yml',
        ref: 'main'
      });
    } catch (e) {
      console.log('Workflow dispatch error:', e.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Đã tạo VPS thành công!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: error.message || 'Có lỗi xảy ra',
      success: false
    });
  }
};
