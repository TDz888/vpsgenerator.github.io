// api/github.js - Xử lý GitHub API
const GITHUB_API = 'https://api.github.com';

function isValidGitHubTokenFormat(token) {
  if (!token || typeof token !== 'string') return false;
  return /^ghp_[A-Za-z0-9]+$/.test(token);
}

function isValidRepoName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 100) return false;
  return /^[a-z0-9]+$/.test(name);
}

async function getGitHubUser(token) {
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function validateGitHubToken(token) {
  if (!isValidGitHubTokenFormat(token)) {
    return { valid: false, error: 'Token GitHub không đúng định dạng. Phải bắt đầu bằng "ghp_".' };
  }
  const user = await getGitHubUser(token);
  if (!user) return { valid: false, error: 'Token không hợp lệ hoặc đã hết hạn' };
  return { valid: true, user: user };
}

export async function createRepository(token, name, description) {
  try {
    if (!isValidRepoName(name)) {
      throw new Error(`Tên "${name}" không hợp lệ. Chỉ được dùng chữ thường và số.`);
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
        description: description || 'Created by Singularity Cloud',
        private: false,
        auto_init: true,
        has_wiki: false,
        has_issues: false
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      if (res.status === 422) throw new Error(`Tên repo không hợp lệ hoặc đã tồn tại: ${err.message}`);
      if (res.status === 401) throw new Error('Token không có quyền tạo repo. Cần quyền "repo"');
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
