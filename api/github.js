// API xử lý GitHub
const GITHUB_API = 'https://api.github.com';

function isValidGitHubToken(token) {
  if (!token || typeof token !== 'string') return false;
  return /^(github_pat_|ghp_|gho_|ghu_|ghs_)[A-Za-z0-9_]+$/.test(token);
}

function isValidRepoName(name) {
  if (!name || name.length < 1 || name.length > 100) return false;
  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name);
}

async function getGitHubUser(token) {
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function validateGitHubToken(token) {
  if (!isValidGitHubToken(token)) {
    return { valid: false, error: 'Token GitHub không đúng định dạng. Phải bắt đầu bằng github_pat_ hoặc ghp_' };
  }
  const user = await getGitHubUser(token);
  if (!user) return { valid: false, error: 'Token không hợp lệ hoặc đã hết hạn' };
  return { valid: true, user: user };
}

export async function createRepository(token, name, desc) {
  try {
    if (!isValidRepoName(name)) {
      throw new Error(`Tên "${name}" không hợp lệ. Chỉ dùng chữ thường, số, dấu gạch ngang.`);
    }
    const user = await getGitHubUser(token);
    if (!user) throw new Error('Không xác thực được user');
    
    const res = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        description: desc,
        private: false,
        auto_init: true,
        has_wiki: false,
        has_issues: false
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
    return { success: true, repo: await res.json(), owner: user.login };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteRepository(token, owner, repo) {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.ok;
  } catch { return false; }
}

export default { validateGitHubToken, createRepository, deleteRepository };
