module.exports = (req, res) => {
  res.json({
    has_gh: !!process.env.GH_TOKEN,
    gh_len: process.env.GH_TOKEN ? process.env.GH_TOKEN.length : 0,
    has_bella: !!process.env.BELLA_ADMIN_TOKEN,
    bella_val: process.env.BELLA_ADMIN_TOKEN
  });
};
