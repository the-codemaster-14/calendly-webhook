const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('Webhook is live');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
