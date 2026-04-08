// api/github.js - Đơn giản, không pattern validation
const GITHUB_API = 'https://api.github.com';

export async function createRepository(token, name, description) {
  try {
    const cleanToken = token ? token.trim() : '';
    const cleanName = name ? name.trim() : '';
    
    const res = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: cleanName,
        description: description || 'Created by Singularity Cloud',
        private: false,
        auto_init: true
      })
    });
    
    if (!res.ok) {
      const error = await res.json();
      return { success: false, error: error.message || `HTTP ${res.status}` };
    }
    
    const repo = await res.json();
    return { success: true, repo: repo, owner: repo.owner.login };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteRepository(token, owner, repo) {
  try {
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return true;
  } catch {
    return false;
  }
}
