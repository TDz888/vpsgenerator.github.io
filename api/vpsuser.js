const { Octokit } = require('@octokit/rest');

module.exports = async (req, res) => {
  // CORS headers
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
    
    // Lấy thông tin user
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const username = user.login;

    // Tên repo ngẫu nhiên
    const repoName = `vps-${Date.now()}`;

    // Tạo repo
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'VPS từ GitHub Actions',
      private: false,
      auto_init: true
    });

    // Nội dung workflow file
    const workflowContent = `name: VPS Auto Deploy

on:
  schedule:
    - cron: '*/10 * * * *'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Chạy VPS
        run: |
          echo "VPS đang chạy..."
          while true; do
            echo "Keep alive - $(date)"
            sleep 60
          done
`;

    // Tạo thư mục .github/workflows và file workflow
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: '.github/workflows/vps.yml',
      message: 'Add VPS workflow',
      content: Buffer.from(workflowContent).toString('base64'),
      branch: 'main'
    });

    // Tạo file README
    const readmeContent = `# VPS Created by Hiếu Dz

VPS đã được tạo thành công!

## Thông tin
- **Repo:** https://github.com/${username}/${repoName}
- **Actions:** https://github.com/${username}/${repoName}/actions

> VPS sẽ chạy liên tục với GitHub Actions
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'README.md',
      message: 'Add README',
      content: Buffer.from(readmeContent).toString('base64'),
      branch: 'main'
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
      console.log('Không thể kích hoạt workflow tự động');
    }

    return res.status(200).json({
      success: true,
      message: 'Đã tạo VPS thành công!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error.message || 'Có lỗi xảy ra',
      success: false
    });
  }
};
