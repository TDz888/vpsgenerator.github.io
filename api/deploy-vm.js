const { Octokit } = require('@octokit/rest');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, owner, repo } = req.body;

  try {
    const octokit = new Octokit({ auth: token });

    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: 'vps.yml',
      ref: 'main'
    });

    res.json({ success: true, message: 'Đã kích hoạt VPS' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
