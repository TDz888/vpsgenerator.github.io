const { Octokit } = require('@octokit/rest');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, repoName } = req.body;

  if (!token || !repoName) {
    return res.status(400).json({ error: 'Thiếu token hoặc tên repo' });
  }

  try {
    const octokit = new Octokit({ auth: token });
    const { data: user } = await octokit.rest.users.getAuthenticated();

    const repo = await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      private: false,
      auto_init: true
    });

    res.json({ success: true, repo: repo.data.html_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
