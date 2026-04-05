const { Octokit } = require('@octokit/rest');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Parse body
  let githubToken = null, tailscaleKey = null;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    githubToken = body.githubToken;
    tailscaleKey = body.tailscaleKey;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON', code: 'INVALID_JSON' });
  }

  if (!githubToken?.trim()) return res.status(400).json({ error: 'Missing GitHub Token', code: 'MISSING_GITHUB_TOKEN' });
  if (!tailscaleKey?.trim()) return res.status(400).json({ error: 'Missing Tailscale Key', code: 'MISSING_TAILSCALE_KEY' });

  const cleanGithubToken = githubToken.trim();
  const cleanTailscaleKey = tailscaleKey.trim();

  try {
    const octokit = new Octokit({ auth: cleanGithubToken });
    
    // Verify token
    let user;
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      user = data;
    } catch (err) {
      if (err.status === 401) return res.status(401).json({ error: 'Invalid GitHub Token', code: 'INVALID_GITHUB_TOKEN' });
      throw err;
    }

    const username = user.login;
    const repoName = `vps-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

    // Tạo repository
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'VPS Windows with Tailscale + noVNC',
      private: false,
      auto_init: true  // ✅ FIX: Tạo repository với initial commit
    });

    // ✅ FIX: Đợi repository khởi tạo xong
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Lấy thông tin branch mặc định
    let defaultBranch = 'main';
    try {
      const repoInfo = await octokit.rest.repos.get({
        owner: username,
        repo: repoName
      });
      defaultBranch = repoInfo.data.default_branch;
    } catch (e) {}

    // Workflow content
    const workflowContent = `name: 🖥️ Windows VPS
on:
  workflow_dispatch:
  schedule:
    - cron: '*/5 * * * *'
env:
  TAILSCALE_AUTH_KEY: ${cleanTailscaleKey}
jobs:
  build:
    runs-on: windows-latest
    timeout-minutes: 360
    steps:
      - name: Enable RDP
        run: |
          Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name "fDenyTSConnections" -Value 0
          netsh advfirewall firewall add rule name="RDP" dir=in action=allow protocol=TCP localport=3389
      - name: Set Password
        run: |
          $password = ConvertTo-SecureString "VPS@123456" -AsPlainText -Force
          Set-LocalUser -Name "runneradmin" -Password $password
      - name: Install Tailscale
        run: |
          $msi = "$env:TEMP\\tailscale.msi"
          Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi" -OutFile $msi
          Start-Process msiexec -ArgumentList "/i $msi /quiet /norestart" -Wait
          & "$env:ProgramFiles\\Tailscale\\tailscale.exe" up --authkey="$env:TAILSCALE_AUTH_KEY" --hostname="vps-windows" --accept-routes
          $ip = & "$env:ProgramFiles\\Tailscale\\tailscale.exe" ip -4
          echo "TAILSCALE_IP=$ip" >> $env:GITHUB_ENV
      - name: Install noVNC
        run: |
          mkdir C:\\novnc
          Set-Location C:\\novnc
          Invoke-WebRequest -Uri "https://codeload.github.com/novnc/noVNC/zip/refs/tags/v1.4.0" -OutFile "novnc.zip"
          Expand-Archive -Path "novnc.zip" -DestinationPath "." -Force
          Move-Item "noVNC-*/*" . -Force
          netsh advfirewall firewall add rule name="noVNC" dir=in action=allow protocol=TCP localport=6080
      - name: Start noVNC
        run: |
          Set-Location C:\\novnc
          Start-Process powershell -ArgumentList "python -m http.server 6080" -WindowStyle Hidden
      - name: Keep Alive
        run: |
          $end = (Get-Date).AddHours(6)
          while ((Get-Date) -lt $end) { Start-Sleep -Seconds 60 }
`;

    // ✅ FIX: Tạo file workflow với branch chính xác
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: '.github/workflows/vps.yml',
      message: 'Add VPS workflow',
      content: Buffer.from(workflowContent).toString('base64'),
      branch: defaultBranch
    });

    // Trigger workflow
    try {
      await octokit.rest.actions.createWorkflowDispatch({
        owner: username,
        repo: repoName,
        workflow_id: 'vps.yml',
        ref: defaultBranch
      });
    } catch (e) {}

    return res.status(200).json({
      success: true,
      id: repoName,
      name: repoName,
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      novncUrl: `https://${username}.github.io/${repoName}/vnc.html`,
      username: 'runneradmin',
      password: 'VPS@123456',
      createdAt,
      expiresAt,
      status: 'creating'
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message, code: 'SYSTEM_ERROR' });
  }
};
